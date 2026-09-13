#![no_std]

mod allowlist;
mod auth;
mod label;
mod policy;
mod types;

#[cfg(test)]
mod test;

pub use label::MAX_LABEL_LEN;
pub use types::*;

use soroban_sdk::{
    contract, contractevent, contractimpl, panic_with_error, token, Address, BytesN, Env, String,
    Vec,
};

/// Extend instance TTL when below ~1 day, up to ~30 days (5s ledgers).
pub(crate) const INSTANCE_TTL_THRESHOLD: u32 = 17_280;
pub(crate) const INSTANCE_TTL_EXTEND_TO: u32 = 518_400;

/// Maximum number of merchants that may be allowlisted at once.
pub const MAX_ALLOWLIST: u32 = 32;

#[contractevent(topics = ["state_changed"])]
pub struct StateChanged {
    pub state: State,
}

#[contractevent(topics = ["withdrawn"])]
pub struct Withdrawn {
    pub to: Address,
    pub amount: i128,
}

/// `merchant` is a topic so the app can subscribe per merchant.
#[contractevent(topics = ["merchant_added"])]
pub struct MerchantAdded {
    #[topic]
    pub merchant: Address,
}

#[contractevent(topics = ["merchant_removed"])]
pub struct MerchantRemoved {
    #[topic]
    pub merchant: Address,
}

#[contractevent(topics = ["policy_changed"])]
pub struct PolicyChanged {
    pub policy: Policy,
}

#[contractevent(topics = ["signer_changed"])]
pub struct SignerChanged {
    pub signer: BytesN<32>,
}

#[contractevent(topics = ["label_changed"])]
pub struct LabelChanged {
    pub label: String,
}

/// Cheapest liveness call: `Storage::instance().extend_ttl` resolves to the
/// host's `extend_current_contract_instance_and_code_ttl`, so it covers the
/// instance *and* the code entry without marshalling an Address argument.
/// Reserved for the payment path (`__check_auth`), where every host call
/// counts against the x402 facilitator's resource-fee ceiling.
pub(crate) fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

/// Explicit instance + contract-code TTL extension. The code entry has its own
/// TTL and, if it archives, the card is unusable until a RestoreFootprint.
/// Used by `bump()` and every owner entrypoint; the payment path uses the
/// cheaper `extend_instance` instead.
pub(crate) fn extend_instance_and_code(env: &Env) {
    env.deployer().extend_ttl(
        env.current_contract_address(),
        INSTANCE_TTL_THRESHOLD,
        INSTANCE_TTL_EXTEND_TO,
    );
}

pub(crate) fn require_owner(env: &Env) {
    let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
    owner.require_auth();
}

fn set_state(env: &Env, state: State) {
    env.storage().instance().set(&DataKey::State, &state);
    StateChanged { state }.publish(env);
}

fn transfer_to_owner(env: &Env, amount: i128) {
    let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
    let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
    // The card is the direct invoker, so this transfer is invoker-authorized and
    // does not pass through __check_auth. Owner ops are not subject to the policy.
    token::Client::new(env, &token).transfer(&env.current_contract_address(), &owner, &amount);
    Withdrawn { to: owner, amount }.publish(env);
}

#[contract]
pub struct Card;

#[contractimpl]
impl Card {
    /// Deploy-time initialization. Runs exactly once (constructor semantics).
    pub fn __constructor(
        env: Env,
        owner: Address,
        signer: BytesN<32>,
        token: Address,
        policy: Policy,
        label: String,
    ) {
        let now = env.ledger().timestamp();
        if policy::validate(now, &policy).is_err() {
            panic_with_error!(&env, CardError::InvalidPolicy);
        }
        if label::validate(&label).is_err() {
            panic_with_error!(&env, CardError::InvalidLabel);
        }
        let s = env.storage().instance();
        s.set(&DataKey::Owner, &owner);
        s.set(&DataKey::Signer, &signer);
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Policy, &policy);
        s.set(
            &DataKey::Period,
            &Period {
                start: now,
                spent: 0,
            },
        );
        s.set(&DataKey::State, &State::Active);
        s.set(&DataKey::Allowlist, &Vec::<Address>::new(&env));
        s.set(&DataKey::Label, &label);
        extend_instance_and_code(&env);
    }

    pub fn owner(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    pub fn signer(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::Signer).unwrap()
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    pub fn policy(env: Env) -> Policy {
        env.storage().instance().get(&DataKey::Policy).unwrap()
    }

    pub fn state(env: Env) -> State {
        env.storage().instance().get(&DataKey::State).unwrap()
    }

    pub fn label(env: Env) -> String {
        env.storage().instance().get(&DataKey::Label).unwrap()
    }

    /// Raw stored period (may be stale if a period boundary has passed).
    pub fn period(env: Env) -> Period {
        env.storage().instance().get(&DataKey::Period).unwrap()
    }

    /// Token balance held by this card.
    pub fn balance(env: Env) -> i128 {
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).balance(&env.current_contract_address())
    }

    /// Owner: allow payments to `merchant`. Idempotent (a repeat add emits no
    /// event). Bounded by MAX_ALLOWLIST.
    pub fn add_merchant(env: Env, merchant: Address) -> Result<(), CardError> {
        require_owner(&env);
        if allowlist::add(&env, &merchant)? {
            MerchantAdded { merchant }.publish(&env);
        }
        extend_instance_and_code(&env);
        Ok(())
    }

    /// Owner: disallow payments to `merchant`. No-op (and no event) if absent.
    pub fn remove_merchant(env: Env, merchant: Address) {
        require_owner(&env);
        if allowlist::remove(&env, &merchant) {
            MerchantRemoved { merchant }.publish(&env);
        }
        extend_instance_and_code(&env);
    }

    pub fn is_allowed(env: Env, merchant: Address) -> bool {
        allowlist::is_allowed(&env, &merchant)
    }

    /// The full allowlist, in insertion order.
    pub fn merchants(env: Env) -> Vec<Address> {
        allowlist::get(&env)
    }

    pub fn allow_count(env: Env) -> u32 {
        allowlist::get(&env).len()
    }

    /// Budget remaining in the current period, accounting for a pending reset.
    pub fn remaining(env: Env) -> i128 {
        policy::remaining(&env)
    }

    /// One-call snapshot of the whole card, for the app. `period` and
    /// `remaining` reflect a pending period reset; `balance` reads the token.
    pub fn info(env: Env) -> CardInfo {
        let s = env.storage().instance();
        let policy: Policy = s.get(&DataKey::Policy).unwrap();
        let stored: Period = s.get(&DataKey::Period).unwrap();
        let period = policy::current_period(env.ledger().timestamp(), &policy, &stored);
        let remaining = (policy.period_amount - period.spent).max(0);
        CardInfo {
            owner: s.get(&DataKey::Owner).unwrap(),
            signer: s.get(&DataKey::Signer).unwrap(),
            token: s.get(&DataKey::Token).unwrap(),
            policy,
            state: s.get(&DataKey::State).unwrap(),
            period,
            remaining,
            balance: Self::balance(env.clone()),
            allow_count: allowlist::get(&env).len(),
            label: s.get(&DataKey::Label).unwrap(),
        }
    }

    /// Owner: replace the spending policy. The spend already made in the period
    /// that applies right now is carried over and a fresh period starts at the
    /// current timestamp, so a change of `period_duration` never silently
    /// resets (or silently extends) the budget. If the new `period_amount` is
    /// below the carried spend, `remaining()` is 0 until the period rolls.
    pub fn set_policy(env: Env, policy: Policy) -> Result<(), CardError> {
        require_owner(&env);
        let now = env.ledger().timestamp();
        policy::validate(now, &policy)?;
        let s = env.storage().instance();
        let old: Policy = s.get(&DataKey::Policy).unwrap();
        let stored: Period = s.get(&DataKey::Period).unwrap();
        let cur = policy::current_period(now, &old, &stored);
        s.set(&DataKey::Policy, &policy);
        s.set(
            &DataKey::Period,
            &Period {
                start: now,
                spent: cur.spent,
            },
        );
        PolicyChanged { policy }.publish(&env);
        extend_instance_and_code(&env);
        Ok(())
    }

    /// Owner: rotate the agent key. Signatures by the previous key stop validating immediately.
    pub fn set_signer(env: Env, signer: BytesN<32>) {
        require_owner(&env);
        env.storage().instance().set(&DataKey::Signer, &signer);
        SignerChanged { signer }.publish(&env);
        extend_instance_and_code(&env);
    }

    /// Owner: rename the card. Renaming is an on-chain transaction.
    pub fn set_label(env: Env, label: String) -> Result<(), CardError> {
        require_owner(&env);
        label::validate(&label)?;
        env.storage().instance().set(&DataKey::Label, &label);
        LabelChanged { label }.publish(&env);
        extend_instance_and_code(&env);
        Ok(())
    }

    /// Owner: pause agent payments. Active → Frozen.
    pub fn freeze(env: Env) -> Result<(), CardError> {
        require_owner(&env);
        if Self::state(env.clone()) != State::Active {
            return Err(CardError::InvalidState);
        }
        set_state(&env, State::Frozen);
        extend_instance_and_code(&env);
        Ok(())
    }

    /// Owner: resume agent payments. Frozen → Active.
    pub fn unfreeze(env: Env) -> Result<(), CardError> {
        require_owner(&env);
        if Self::state(env.clone()) != State::Frozen {
            return Err(CardError::InvalidState);
        }
        set_state(&env, State::Active);
        extend_instance_and_code(&env);
        Ok(())
    }

    /// Owner: permanently disable the card and sweep its full balance to the owner.
    pub fn cancel(env: Env) -> Result<(), CardError> {
        require_owner(&env);
        if Self::state(env.clone()) == State::Cancelled {
            return Err(CardError::InvalidState);
        }
        set_state(&env, State::Cancelled);
        let bal = Self::balance(env.clone());
        if bal > 0 {
            transfer_to_owner(&env, bal);
        }
        extend_instance_and_code(&env);
        Ok(())
    }

    /// Owner: move `amount` of the token to the owner. Allowed in any state.
    pub fn withdraw(env: Env, amount: i128) -> Result<(), CardError> {
        require_owner(&env);
        if amount <= 0 {
            return Err(CardError::InvalidAmount);
        }
        transfer_to_owner(&env, amount);
        extend_instance_and_code(&env);
        Ok(())
    }

    /// Anyone: extend the card's instance *and code* TTL so it does not get archived.
    pub fn bump(env: Env) {
        extend_instance_and_code(&env);
    }
}
