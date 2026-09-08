use soroban_sdk::{Address, Env};

use crate::types::{CardError, DataKey};
use crate::MAX_ALLOWLIST;

/// Persistent keys get a long TTL; the instance extension covers the rest.
const ALLOWED_TTL_THRESHOLD: u32 = 17_280;
const ALLOWED_TTL_EXTEND_TO: u32 = 518_400;

fn count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::AllowCount)
        .unwrap_or(0)
}

fn set_count(env: &Env, n: u32) {
    env.storage().instance().set(&DataKey::AllowCount, &n);
}

pub(crate) fn is_allowed(env: &Env, merchant: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Allowed(merchant.clone()))
}

pub(crate) fn add(env: &Env, merchant: &Address) -> Result<(), CardError> {
    let key = DataKey::Allowed(merchant.clone());
    let p = env.storage().persistent();
    if p.has(&key) {
        p.extend_ttl(&key, ALLOWED_TTL_THRESHOLD, ALLOWED_TTL_EXTEND_TO);
        return Ok(());
    }
    let n = count(env);
    if n >= MAX_ALLOWLIST {
        return Err(CardError::AllowlistFull);
    }
    p.set(&key, &true);
    p.extend_ttl(&key, ALLOWED_TTL_THRESHOLD, ALLOWED_TTL_EXTEND_TO);
    set_count(env, n + 1);
    Ok(())
}

pub(crate) fn remove(env: &Env, merchant: &Address) {
    let key = DataKey::Allowed(merchant.clone());
    let p = env.storage().persistent();
    if p.has(&key) {
        p.remove(&key);
        set_count(env, count(env).saturating_sub(1));
    }
}
