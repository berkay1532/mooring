use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::{Address, BytesN, Env};

use super::{default_policy, fund_card, setup, DAY, T0, USDC};
use crate::{Card, Period, Policy, State};

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
        (owner, BytesN::from_array(env, &[1u8; 32]), token, policy),
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
