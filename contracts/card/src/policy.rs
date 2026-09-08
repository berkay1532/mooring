use soroban_sdk::{Address, Env};

use crate::allowlist;
use crate::types::{CardError, DataKey, Period, Policy, State};

/// Returns the period that applies at `now`. If one or more period boundaries
/// have passed since `stored.start`, the start aligns to the most recent boundary
/// and `spent` resets to zero (no carry-over).
pub(crate) fn current_period(now: u64, policy: &Policy, stored: &Period) -> Period {
    let end = stored.start.saturating_add(policy.period_duration);
    if now < end {
        return stored.clone();
    }
    let elapsed = now - stored.start;
    let periods = elapsed / policy.period_duration;
    Period {
        start: stored.start + periods * policy.period_duration,
        spent: 0,
    }
}

/// Validates a payment of `amount` to `to` against state, expiry, allowlist,
/// per-tx cap and period budget. On success persists the updated period.
///
/// Not yet wired to a public entrypoint: `__check_auth` (Task 6) will call
/// this to gate every agent payment. Exercised directly by unit tests until then.
#[allow(dead_code)]
pub(crate) fn enforce_payment(env: &Env, to: &Address, amount: i128) -> Result<(), CardError> {
    if amount <= 0 {
        return Err(CardError::InvalidAmount);
    }
    let s = env.storage().instance();
    match s.get::<_, State>(&DataKey::State).unwrap() {
        State::Active => {}
        State::Frozen => return Err(CardError::Frozen),
        State::Cancelled => return Err(CardError::Cancelled),
    }
    let now = env.ledger().timestamp();
    let policy: Policy = s.get(&DataKey::Policy).unwrap();
    if now >= policy.expiry {
        return Err(CardError::Expired);
    }
    if !allowlist::is_allowed(env, to) {
        return Err(CardError::NotAllowlisted);
    }
    if amount > policy.max_per_tx {
        return Err(CardError::OverPerTxCap);
    }
    let stored: Period = s.get(&DataKey::Period).unwrap();
    let mut period = current_period(now, &policy, &stored);
    let new_spent = period
        .spent
        .checked_add(amount)
        .ok_or(CardError::OverBudget)?;
    if new_spent > policy.period_amount {
        return Err(CardError::OverBudget);
    }
    period.spent = new_spent;
    s.set(&DataKey::Period, &period);
    crate::extend_instance(env);
    Ok(())
}

/// Budget left in the period that applies right now (read-only).
pub(crate) fn remaining(env: &Env) -> i128 {
    let s = env.storage().instance();
    let policy: Policy = s.get(&DataKey::Policy).unwrap();
    let stored: Period = s.get(&DataKey::Period).unwrap();
    let period = current_period(env.ledger().timestamp(), &policy, &stored);
    policy.period_amount - period.spent
}
