use soroban_sdk::testutils::{Address as _, Deployer as _, Ledger as _};
use soroban_sdk::Address;

use super::{default_policy, setup, Fixture, DAY, T0, USDC};
use crate::policy::{current_period, enforce_payment};
use crate::{CardError, Period, State, INSTANCE_TTL_EXTEND_TO, INSTANCE_TTL_THRESHOLD};

fn allowed_merchant(f: &Fixture) -> Address {
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    m
}

fn pay(f: &Fixture, to: &Address, amount: i128) -> Result<(), CardError> {
    f.env
        .as_contract(&f.card, || enforce_payment(&f.env, to, amount))
}

// ---- current_period (pure) ----

#[test]
fn period_unchanged_before_boundary() {
    let p = default_policy();
    let stored = Period {
        start: T0,
        spent: 7,
    };
    assert_eq!(current_period(T0 + DAY - 1, &p, &stored), stored);
}

#[test]
fn period_resets_at_boundary() {
    let p = default_policy();
    let stored = Period {
        start: T0,
        spent: 7,
    };
    assert_eq!(
        current_period(T0 + DAY, &p, &stored),
        Period {
            start: T0 + DAY,
            spent: 0
        }
    );
}

#[test]
fn period_skips_multiple_boundaries_once() {
    let p = default_policy();
    let stored = Period {
        start: T0,
        spent: 7,
    };
    // 2.5 periods later → start aligns to the 2nd boundary, spent resets.
    assert_eq!(
        current_period(T0 + 2 * DAY + DAY / 2, &p, &stored),
        Period {
            start: T0 + 2 * DAY,
            spent: 0
        }
    );
}

// ---- enforce_payment ----

#[test]
fn accepts_within_budget_and_accounts_spend() {
    let f = setup();
    let m = allowed_merchant(&f);
    assert_eq!(pay(&f, &m, 4 * USDC), Ok(()));
    assert_eq!(
        f.client.period(),
        Period {
            start: T0,
            spent: 4 * USDC
        }
    );
    assert_eq!(f.client.remaining(), 46 * USDC);
}

#[test]
fn rejects_over_budget_across_multiple_payments() {
    let f = setup();
    let m = allowed_merchant(&f);
    for _ in 0..5 {
        assert_eq!(pay(&f, &m, 10 * USDC), Ok(()));
    }
    assert_eq!(f.client.remaining(), 0);
    assert_eq!(pay(&f, &m, 1), Err(CardError::OverBudget));
    // Failed attempt must not change accounting.
    assert_eq!(f.client.period().spent, 50 * USDC);
}

#[test]
fn rejects_over_per_tx_cap() {
    let f = setup();
    let m = allowed_merchant(&f);
    assert_eq!(pay(&f, &m, 10 * USDC + 1), Err(CardError::OverPerTxCap));
}

#[test]
fn rejects_unlisted_merchant() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    assert_eq!(pay(&f, &stranger, USDC), Err(CardError::NotAllowlisted));
}

#[test]
fn rejects_nonpositive_amount() {
    let f = setup();
    let m = allowed_merchant(&f);
    assert_eq!(pay(&f, &m, 0), Err(CardError::InvalidAmount));
    assert_eq!(pay(&f, &m, -1), Err(CardError::InvalidAmount));
}

#[test]
fn rejects_after_expiry() {
    let f = setup();
    let m = allowed_merchant(&f);
    f.env.ledger().set_timestamp(default_policy().expiry);
    assert_eq!(pay(&f, &m, USDC), Err(CardError::Expired));
}

#[test]
fn budget_resets_in_next_period() {
    let f = setup();
    let m = allowed_merchant(&f);
    for _ in 0..5 {
        assert_eq!(pay(&f, &m, 10 * USDC), Ok(()));
    }
    f.env.ledger().set_timestamp(T0 + DAY);
    assert_eq!(f.client.remaining(), 50 * USDC);
    assert_eq!(pay(&f, &m, 10 * USDC), Ok(()));
    assert_eq!(
        f.client.period(),
        Period {
            start: T0 + DAY,
            spent: 10 * USDC
        }
    );
}

#[test]
fn rejects_when_frozen_or_cancelled() {
    let f = setup();
    let m = allowed_merchant(&f);
    f.env.as_contract(&f.card, || {
        f.env
            .storage()
            .instance()
            .set(&crate::DataKey::State, &State::Frozen);
    });
    assert_eq!(pay(&f, &m, USDC), Err(CardError::Frozen));
    f.env.as_contract(&f.card, || {
        f.env
            .storage()
            .instance()
            .set(&crate::DataKey::State, &State::Cancelled);
    });
    assert_eq!(pay(&f, &m, USDC), Err(CardError::Cancelled));
}

#[test]
fn payment_path_keeps_the_card_alive() {
    // `enforce_payment` runs inside `__check_auth`, under the x402
    // facilitator's resource-fee ceiling, so it uses the cheapest liveness
    // call available: `Storage::instance().extend_ttl`, which the host
    // resolves to `extend_current_contract_instance_and_code_ttl` -- instance
    // and code, no Address argument to marshal. Owner entrypoints and `bump()`
    // use the explicit `Deployer::extend_ttl` form instead.
    let f = setup();
    let m = allowed_merchant(&f);
    f.env
        .ledger()
        .set_sequence_number(INSTANCE_TTL_EXTEND_TO - 1_000);
    assert!(f.env.deployer().get_contract_instance_ttl(&f.card) < INSTANCE_TTL_THRESHOLD);

    assert_eq!(pay(&f, &m, USDC), Ok(()));

    assert_eq!(
        f.env.deployer().get_contract_instance_ttl(&f.card),
        INSTANCE_TTL_EXTEND_TO
    );
    assert_eq!(
        f.env.deployer().get_contract_code_ttl(&f.card),
        INSTANCE_TTL_EXTEND_TO
    );
}
