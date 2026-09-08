#![no_std]

mod allowlist;
mod auth;
mod policy;
mod types;

#[cfg(test)]
mod test;

pub use types::*;

use soroban_sdk::{
    contract, contractevent, contractimpl, panic_with_error, token, Address, BytesN, Env,
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

#[contractevent(topics = ["merchant_added"])]
pub struct MerchantAdded {
    pub merchant: Address,
}

#[contractevent(topics = ["merchant_removed"])]
pub struct MerchantRemoved {
    pub merchant: Address,
}

pub(crate) fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
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
    ) {
        let now = env.ledger().timestamp();
        if policy.period_amount <= 0
            || policy.period_duration == 0
            || policy.max_per_tx <= 0
            || policy.max_per_tx > policy.period_amount
            || policy.expiry <= now
        {
            panic_with_error!(&env, CardError::InvalidPolicy);
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
        s.set(&DataKey::AllowCount, &0u32);
        extend_instance(&env);
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

    /// Raw stored period (may be stale if a period boundary has passed).
    pub fn period(env: Env) -> Period {
        env.storage().instance().get(&DataKey::Period).unwrap()
    }

    /// Token balance held by this card.
    pub fn balance(env: Env) -> i128 {
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).balance(&env.current_contract_address())
    }

    /// Owner: allow payments to `merchant`. Idempotent. Bounded by MAX_ALLOWLIST.
    pub fn add_merchant(env: Env, merchant: Address) -> Result<(), CardError> {
        require_owner(&env);
        allowlist::add(&env, &merchant)?;
        MerchantAdded {
            merchant: merchant.clone(),
        }
        .publish(&env);
        extend_instance(&env);
        Ok(())
    }

    /// Owner: disallow payments to `merchant`. No-op if absent.
    pub fn remove_merchant(env: Env, merchant: Address) {
        require_owner(&env);
        allowlist::remove(&env, &merchant);
        MerchantRemoved {
            merchant: merchant.clone(),
        }
        .publish(&env);
        extend_instance(&env);
    }

    pub fn is_allowed(env: Env, merchant: Address) -> bool {
        allowlist::is_allowed(&env, &merchant)
    }

    pub fn allow_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::AllowCount)
            .unwrap_or(0)
    }

    /// Budget remaining in the current period, accounting for a pending reset.
    pub fn remaining(env: Env) -> i128 {
        policy::remaining(&env)
    }

    /// Owner: pause agent payments. Active → Frozen.
    pub fn freeze(env: Env) -> Result<(), CardError> {
        require_owner(&env);
        if Self::state(env.clone()) != State::Active {
            return Err(CardError::InvalidState);
        }
        set_state(&env, State::Frozen);
        extend_instance(&env);
        Ok(())
    }

    /// Owner: resume agent payments. Frozen → Active.
    pub fn unfreeze(env: Env) -> Result<(), CardError> {
        require_owner(&env);
        if Self::state(env.clone()) != State::Frozen {
            return Err(CardError::InvalidState);
        }
        set_state(&env, State::Active);
        extend_instance(&env);
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
        extend_instance(&env);
        Ok(())
    }

    /// Owner: move `amount` of the token to the owner. Allowed in any state.
    pub fn withdraw(env: Env, amount: i128) -> Result<(), CardError> {
        require_owner(&env);
        if amount <= 0 {
            return Err(CardError::InvalidAmount);
        }
        transfer_to_owner(&env, amount);
        extend_instance(&env);
        Ok(())
    }

    /// Anyone: extend the card's instance TTL so it does not get archived.
    pub fn bump(env: Env) {
        extend_instance(&env);
    }
}
