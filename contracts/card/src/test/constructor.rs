use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::{Address, BytesN, Env, String};

use super::{default_policy, fund_card, setup, DAY, LABEL, T0, USDC};
use crate::{Card, CardInfo, Period, Policy, State};

#[test]
fn constructor_stores_config_and_starts_active() {
    let f = setup();
    assert_eq!(f.client.owner(), f.owner);
    assert_eq!(f.client.signer(), f.agent_pk);
    assert_eq!(f.client.token(), f.token);
    assert_eq!(f.client.policy(), default_policy());
    assert_eq!(f.client.state(), State::Active);
    assert_eq!(
        f.client.period(),
        Period {
            start: T0,
            spent: 0
        }
    );
}

#[test]
fn balance_reflects_token_holdings() {
    let f = setup();
    assert_eq!(f.client.balance(), 0);
    fund_card(&f, 25 * USDC);
    assert_eq!(f.client.balance(), 25 * USDC);
}

fn register_with(env: &Env, policy: Policy) {
    let owner = Address::generate(env);
    let admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    env.register(
        Card,
        (
            owner,
            BytesN::from_array(env, &[1u8; 32]),
            token,
            policy,
            String::from_str(env, LABEL),
        ),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_zero_period_amount() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with(
        &env,
        Policy {
            period_amount: 0,
            ..default_policy()
        },
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_zero_duration() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with(
        &env,
        Policy {
            period_duration: 0,
            ..default_policy()
        },
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_per_tx_cap_above_budget() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with(
        &env,
        Policy {
            max_per_tx: 60 * USDC,
            ..default_policy()
        },
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_past_expiry() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with(
        &env,
        Policy {
            expiry: T0,
            ..default_policy()
        },
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_nonpositive_per_tx_cap() {
    let env = Env::default();
    env.ledger().set_timestamp(T0 + DAY);
    register_with(
        &env,
        Policy {
            max_per_tx: 0,
            expiry: T0 + 2 * DAY,
            ..default_policy()
        },
    );
}

#[test]
fn info_snapshots_the_whole_card_state() {
    let f = setup();
    fund_card(&f, 25 * USDC);
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    f.env
        .as_contract(&f.card, || {
            crate::policy::enforce_payment(&f.env, &m, 4 * USDC)
        })
        .unwrap();

    assert_eq!(
        f.client.info(),
        CardInfo {
            owner: f.owner.clone(),
            signer: f.agent_pk.clone(),
            token: f.token.clone(),
            policy: default_policy(),
            state: State::Active,
            period: Period {
                start: T0,
                spent: 4 * USDC
            },
            remaining: 46 * USDC,
            balance: 25 * USDC,
            allow_count: 1,
            label: String::from_str(&f.env, LABEL),
        }
    );
}

#[test]
fn info_materializes_a_pending_period_reset() {
    // `period()` returns the raw stored period; `info()` must report the
    // period that actually applies now, so a UI never shows stale spend.
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    f.env
        .as_contract(&f.card, || {
            crate::policy::enforce_payment(&f.env, &m, 4 * USDC)
        })
        .unwrap();

    f.env.ledger().set_timestamp(T0 + 3 * DAY);
    assert_eq!(f.client.period().spent, 4 * USDC); // stale, by design
    let i = f.client.info();
    assert_eq!(
        i.period,
        Period {
            start: T0 + 3 * DAY,
            spent: 0
        }
    );
    assert_eq!(i.remaining, 50 * USDC);
}
