use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address};

use super::setup;
use crate::{CardError, MAX_ALLOWLIST};

#[test]
fn owner_can_add_and_remove_merchants() {
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);

    assert!(!f.client.is_allowed(&m));
    f.client.add_merchant(&m);
    assert!(f.client.is_allowed(&m));
    assert_eq!(f.client.allow_count(), 1);

    f.client.remove_merchant(&m);
    assert!(!f.client.is_allowed(&m));
    assert_eq!(f.client.allow_count(), 0);
}

#[test]
fn adding_same_merchant_twice_is_idempotent() {
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    f.client.add_merchant(&m);
    assert_eq!(f.client.allow_count(), 1);
}

#[test]
fn removing_unknown_merchant_is_noop() {
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.remove_merchant(&m);
    assert_eq!(f.client.allow_count(), 0);
}

#[test]
fn allowlist_is_bounded() {
    let f = setup();
    f.env.mock_all_auths();
    for _ in 0..MAX_ALLOWLIST {
        f.client.add_merchant(&Address::generate(&f.env));
    }
    let extra = Address::generate(&f.env);
    let err = f.client.try_add_merchant(&extra).unwrap_err().unwrap();
    assert_eq!(err, CardError::AllowlistFull);
}

#[test]
#[should_panic(expected = "Auth")]
fn add_merchant_requires_owner_auth() {
    let f = setup();
    // No mock_all_auths: require_auth on owner fails.
    f.client.add_merchant(&Address::generate(&f.env));
}

#[test]
fn merchants_enumerates_the_allowlist() {
    let f = setup();
    f.env.mock_all_auths();
    let a = Address::generate(&f.env);
    let b = Address::generate(&f.env);
    f.client.add_merchant(&a);
    f.client.add_merchant(&b);
    assert_eq!(f.client.merchants(), vec![&f.env, a.clone(), b.clone()]);

    f.client.remove_merchant(&a);
    assert_eq!(f.client.merchants(), vec![&f.env, b]);
    assert_eq!(f.client.allow_count(), 1);
}
