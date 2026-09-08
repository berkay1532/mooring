use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{Address, BytesN};

use super::{default_policy, setup, DAY, T0, USDC};
use crate::policy::enforce_payment;
use crate::{CardError, Policy};

#[test]
fn owner_can_update_policy() {
    let f = setup();
    f.env.mock_all_auths();
    let new = Policy {
        period_amount: 100 * USDC,
        period_duration: 7 * DAY,
        max_per_tx: 20 * USDC,
        expiry: T0 + 60 * DAY,
    };
    f.client.set_policy(&new);
    assert_eq!(f.client.policy(), new);
    assert_eq!(f.client.remaining(), 100 * USDC);
}

#[test]
fn policy_update_keeps_current_period_spend() {
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    f.env
        .as_contract(&f.card, || enforce_payment(&f.env, &m, 10 * USDC))
        .unwrap();

    f.client.set_policy(&Policy {
        period_amount: 15 * USDC,
        ..default_policy()
    });
    assert_eq!(f.client.remaining(), 5 * USDC);
}

#[test]
fn remaining_clamps_to_zero_when_budget_lowered_below_spend() {
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    f.env
        .as_contract(&f.card, || enforce_payment(&f.env, &m, 10 * USDC))
        .unwrap();

    f.client.set_policy(&Policy {
        period_amount: 5 * USDC,
        max_per_tx: 5 * USDC,
        ..default_policy()
    });
    assert_eq!(f.client.remaining(), 0);
    let r = f
        .env
        .as_contract(&f.card, || enforce_payment(&f.env, &m, 1));
    assert_eq!(r, Err(CardError::OverBudget));
}

#[test]
fn set_policy_validates_like_constructor() {
    let f = setup();
    f.env.mock_all_auths();
    let bad = [
        Policy {
            period_amount: 0,
            ..default_policy()
        },
        Policy {
            period_duration: 0,
            ..default_policy()
        },
        Policy {
            max_per_tx: 0,
            ..default_policy()
        },
        Policy {
            max_per_tx: 60 * USDC,
            ..default_policy()
        },
        Policy {
            expiry: T0,
            ..default_policy()
        },
    ];
    for p in bad {
        assert_eq!(
            f.client.try_set_policy(&p).unwrap_err().unwrap(),
            CardError::InvalidPolicy
        );
    }
    assert_eq!(f.client.policy(), default_policy());
}

#[test]
#[should_panic(expected = "Auth")]
fn set_policy_requires_owner_auth() {
    let f = setup();
    f.client.set_policy(&default_policy());
}

#[test]
fn owner_can_rotate_signer() {
    let f = setup();
    f.env.mock_all_auths();
    let new = BytesN::from_array(&f.env, &[9u8; 32]);
    f.client.set_signer(&new);
    assert_eq!(f.client.signer(), new);
}

#[test]
#[should_panic(expected = "Auth")]
fn set_signer_requires_owner_auth() {
    let f = setup();
    f.client.set_signer(&BytesN::from_array(&f.env, &[9u8; 32]));
}

#[test]
fn update_ops_emit_events() {
    // The test env's event log reflects only the most recent top-level
    // contract invocation, so each op's events are counted right after it
    // and the counts are summed rather than diffed around both calls.
    let f = setup();
    f.env.mock_all_auths();
    f.client.set_policy(&default_policy());
    let policy_events = f.env.events().all().events().len();
    f.client.set_signer(&BytesN::from_array(&f.env, &[9u8; 32]));
    let signer_events = f.env.events().all().events().len();
    assert_eq!(policy_events + signer_events, 2);
}

/// Spends `10 USDC` to a fresh allowlisted merchant 20 hours into the first
/// period and returns the ledger timestamp at which it happened.
fn spend_10_usdc_at_t0_plus_20h(f: &super::Fixture) -> u64 {
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    let now = T0 + 20 * 3_600;
    f.env.ledger().set_timestamp(now);
    f.env
        .as_contract(&f.card, || enforce_payment(&f.env, &m, 10 * USDC))
        .unwrap();
    now
}

#[test]
fn shortening_the_period_carries_the_spend_over() {
    // Without carry-over the shorter duration would make the stored period look
    // long expired, silently resetting `spent` and handing back a full budget.
    let f = setup();
    f.env.mock_all_auths();
    let now = spend_10_usdc_at_t0_plus_20h(&f);

    f.client.set_policy(&Policy {
        period_duration: 3_600,
        ..default_policy()
    });

    assert_eq!(f.client.remaining(), 40 * USDC);
    assert_eq!(f.client.period().spent, 10 * USDC);
    assert_eq!(f.client.period().start, now);
}

#[test]
fn lengthening_the_period_keeps_the_spend_and_restarts_at_now() {
    let f = setup();
    f.env.mock_all_auths();
    let now = spend_10_usdc_at_t0_plus_20h(&f);

    f.client.set_policy(&Policy {
        period_duration: 7 * DAY,
        ..default_policy()
    });

    assert_eq!(f.client.remaining(), 40 * USDC);
    assert_eq!(f.client.period().spent, 10 * USDC);
    // The new duration counts from the change, not from the old period start.
    assert_eq!(f.client.period().start, now);
}
