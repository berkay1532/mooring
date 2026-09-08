use soroban_sdk::{Address, Env, Vec};

use crate::types::{CardError, DataKey};
use crate::MAX_ALLOWLIST;

/// The allowlist lives in instance storage as one bounded `Vec<Address>`.
/// Instance storage shares the contract instance's TTL, so it stays live for
/// as long as the card itself does -- unlike per-merchant persistent keys,
/// which are only bumped when written and would archive under a card that is
/// otherwise kept alive. It is also enumerable for the app (`merchants()`).
pub(crate) fn get(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Allowlist)
        .unwrap_or_else(|| Vec::new(env))
}

fn set(env: &Env, list: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Allowlist, list);
}

pub(crate) fn is_allowed(env: &Env, merchant: &Address) -> bool {
    get(env).contains(merchant)
}

/// Adds `merchant`. Returns `true` if the list changed (i.e. it was absent).
pub(crate) fn add(env: &Env, merchant: &Address) -> Result<bool, CardError> {
    let mut list = get(env);
    if list.contains(merchant) {
        return Ok(false);
    }
    if list.len() >= MAX_ALLOWLIST {
        return Err(CardError::AllowlistFull);
    }
    list.push_back(merchant.clone());
    set(env, &list);
    Ok(true)
}

/// Removes `merchant`. Returns `true` if the list changed (i.e. it was present).
pub(crate) fn remove(env: &Env, merchant: &Address) -> bool {
    let mut list = get(env);
    match list.first_index_of(merchant) {
        Some(i) => {
            list.remove(i);
            set(env, &list);
            true
        }
        None => false,
    }
}
