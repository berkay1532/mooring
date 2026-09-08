extern crate std;

use soroban_sdk::testutils::{Address as _, Deployer as _, Events as _, Ledger as _};
use soroban_sdk::{token, vec, Address, Event, IntoVal, Map, Symbol, Val};

use super::{fund_card, setup, USDC};
use crate::{
    CardError, MerchantAdded, MerchantRemoved, State, StateChanged, Withdrawn,
    INSTANCE_TTL_EXTEND_TO, INSTANCE_TTL_THRESHOLD,
};

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

// The test env's event log reflects only the most recent top-level contract
// invocation (it does not accumulate across separate calls made from a test),
// so every assertion below sits immediately after the call it covers.

#[test]
fn freeze_and_unfreeze_emit_state_changed() {
    let f = setup();
    f.env.mock_all_auths();
    f.client.freeze();
    assert_eq!(
        f.env.events().all(),
        std::vec![StateChanged {
            state: State::Frozen
        }
        .to_xdr(&f.env, &f.card)]
    );
    f.client.unfreeze();
    assert_eq!(
        f.env.events().all(),
        std::vec![StateChanged {
            state: State::Active
        }
        .to_xdr(&f.env, &f.card)]
    );
}

#[test]
fn merchant_events_are_exact_and_skipped_on_no_ops() {
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);

    f.client.add_merchant(&m);
    assert_eq!(
        f.env.events().all(),
        std::vec![MerchantAdded {
            merchant: m.clone()
        }
        .to_xdr(&f.env, &f.card)]
    );

    // Re-adding changes nothing, so it must not emit.
    f.client.add_merchant(&m);
    assert!(f.env.events().all().events().is_empty());

    f.client.remove_merchant(&m);
    assert_eq!(
        f.env.events().all(),
        std::vec![MerchantRemoved {
            merchant: m.clone()
        }
        .to_xdr(&f.env, &f.card)]
    );

    // Removing an absent merchant changes nothing either.
    f.client.remove_merchant(&m);
    assert!(f.env.events().all().events().is_empty());
}

#[test]
fn merchant_is_an_indexed_topic() {
    // The app subscribes per merchant, so the address must be a topic and not
    // buried in the event body.
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);

    assert_eq!(
        f.env.events().all(),
        vec![
            &f.env,
            (
                f.card.clone(),
                vec![
                    &f.env,
                    Symbol::new(&f.env, "merchant_added").into_val(&f.env),
                    m.into_val(&f.env),
                ],
                Map::<Symbol, Val>::new(&f.env).into_val(&f.env),
            )
        ]
    );
}

#[test]
fn withdraw_and_cancel_emit_exact_events() {
    let f = setup();
    fund_card(&f, 30 * USDC);
    f.env.mock_all_auths();

    // The SAC emits its own `transfer` event too; only the card's are asserted.
    f.client.withdraw(&(10 * USDC));
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.card),
        std::vec![Withdrawn {
            to: f.owner.clone(),
            amount: 10 * USDC
        }
        .to_xdr(&f.env, &f.card)]
    );

    f.client.cancel();
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.card),
        std::vec![
            StateChanged {
                state: State::Cancelled
            }
            .to_xdr(&f.env, &f.card),
            Withdrawn {
                to: f.owner.clone(),
                amount: 20 * USDC
            }
            .to_xdr(&f.env, &f.card),
        ]
    );
}

#[test]
fn bump_extends_instance_and_code_ttl() {
    // The code entry has its own TTL: an instance-only extension leaves it to
    // archive, which bricks the card until a RestoreFootprint.
    let f = setup();
    f.env
        .ledger()
        .set_sequence_number(INSTANCE_TTL_EXTEND_TO - 1_000);
    assert!(f.env.deployer().get_contract_code_ttl(&f.card) < INSTANCE_TTL_THRESHOLD);

    f.client.bump();

    assert_eq!(
        f.env.deployer().get_contract_instance_ttl(&f.card),
        INSTANCE_TTL_EXTEND_TO
    );
    assert_eq!(
        f.env.deployer().get_contract_code_ttl(&f.card),
        INSTANCE_TTL_EXTEND_TO
    );
}

#[test]
fn owner_ops_extend_the_code_ttl() {
    let f = setup();
    f.env.mock_all_auths();
    f.env
        .ledger()
        .set_sequence_number(INSTANCE_TTL_EXTEND_TO - 1_000);
    f.client.freeze();
    assert_eq!(
        f.env.deployer().get_contract_code_ttl(&f.card),
        INSTANCE_TTL_EXTEND_TO
    );
}
