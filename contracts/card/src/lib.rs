#![no_std]

mod allowlist;
mod policy;
mod types;

#[cfg(test)]
mod test;

pub use types::*;

use soroban_sdk::{contract, contractimpl, panic_with_error, token, Address, BytesN, Env};

/// Extend instance TTL when below ~1 day, up to ~30 days (5s ledgers).
pub(crate) const INSTANCE_TTL_THRESHOLD: u32 = 17_280;
pub(crate) const INSTANCE_TTL_EXTEND_TO: u32 = 518_400;

/// Maximum number of merchants that may be allowlisted at once.
pub const MAX_ALLOWLIST: u32 = 32;

pub(crate) fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

pub(crate) fn require_owner(env: &Env) {
    let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
    owner.require_auth();
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
        extend_instance(&env);
        Ok(())
    }

    /// Owner: disallow payments to `merchant`. No-op if absent.
    pub fn remove_merchant(env: Env, merchant: Address) {
        require_owner(&env);
        allowlist::remove(&env, &merchant);
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
}
