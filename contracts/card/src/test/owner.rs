use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::{token, Address};

use super::{fund_card, setup, USDC};
use crate::{CardError, State};

fn owner_balance(f: &super::Fixture) -> i128 {
    token::Client::new(&f.env, &f.token).balance(&f.owner)
}

#[test]
fn freeze_and_unfreeze_transition_state() {
    let f = setup();
    f.env.mock_all_auths();
    f.client.freeze();
    assert_eq!(f.client.state(), State::Frozen);
    f.client.unfreeze();
    assert_eq!(f.client.state(), State::Active);
}

#[test]
fn freeze_twice_is_invalid_state() {
    let f = setup();
    f.env.mock_all_auths();
    f.client.freeze();
    assert_eq!(
        f.client.try_freeze().unwrap_err().unwrap(),
        CardError::InvalidState
    );
}

#[test]
fn unfreeze_when_active_is_invalid_state() {
    let f = setup();
    f.env.mock_all_auths();
    assert_eq!(
        f.client.try_unfreeze().unwrap_err().unwrap(),
        CardError::InvalidState
    );
}

#[test]
fn cancel_sweeps_balance_to_owner_and_is_terminal() {
    let f = setup();
    fund_card(&f, 30 * USDC);
    f.env.mock_all_auths();
    f.client.cancel();
    assert_eq!(f.client.state(), State::Cancelled);
    assert_eq!(f.client.balance(), 0);
    assert_eq!(owner_balance(&f), 30 * USDC);
    assert_eq!(
        f.client.try_unfreeze().unwrap_err().unwrap(),
        CardError::InvalidState
    );
    assert_eq!(
        f.client.try_freeze().unwrap_err().unwrap(),
        CardError::InvalidState
    );
    assert_eq!(
        f.client.try_cancel().unwrap_err().unwrap(),
        CardError::InvalidState
    );
}

#[test]
fn cancel_with_zero_balance_succeeds() {
    let f = setup();
    f.env.mock_all_auths();
    f.client.cancel();
    assert_eq!(f.client.state(), State::Cancelled);
}

#[test]
fn withdraw_moves_tokens_to_owner_in_any_state() {
    let f = setup();
    fund_card(&f, 30 * USDC);
    f.env.mock_all_auths();
    f.client.withdraw(&(10 * USDC));
    assert_eq!(f.client.balance(), 20 * USDC);
    assert_eq!(owner_balance(&f), 10 * USDC);
    f.client.freeze();
    f.client.withdraw(&(5 * USDC));
    assert_eq!(f.client.balance(), 15 * USDC);
}

#[test]
fn withdraw_rejects_nonpositive_amount() {
    let f = setup();
    f.env.mock_all_auths();
    assert_eq!(
        f.client.try_withdraw(&0).unwrap_err().unwrap(),
        CardError::InvalidAmount
    );
}

#[test]
#[should_panic(expected = "Auth")]
fn withdraw_requires_owner_auth() {
    // No mock_all_auths: the owner auth check must fire before any transfer.
    let g = setup();
    g.client.withdraw(&1);
}

#[test]
fn bump_is_callable_by_anyone() {
    let f = setup();
    f.client.bump(); // no auth, must not panic
}

#[test]
fn owner_ops_emit_events() {
    // The test env's event log reflects only the most recent top-level
    // contract invocation (it does not accumulate across separate calls
    // made from a test), so each owner call is counted individually and
    // the counts are summed rather than diffed around both calls.
    let f = setup();
    f.env.mock_all_auths();
    f.client.freeze();
    let freeze_events = f.env.events().all().events().len();
    f.client.add_merchant(&Address::generate(&f.env));
    let add_merchant_events = f.env.events().all().events().len();
    assert_eq!(freeze_events + add_merchant_events, 2);
}
