extern crate std;

use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{Address, BytesN, Env, Event, String};

use super::{default_policy, setup, LABEL, T0};
use crate::{Card, CardError, LabelChanged, MAX_LABEL_LEN};

fn register_with_label(env: &Env, label: &str) {
    let owner = Address::generate(env);
    let admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    env.register(
        Card,
        (
            owner,
            BytesN::from_array(env, &[1u8; 32]),
            token,
            default_policy(),
            String::from_str(env, label),
        ),
    );
}

#[test]
fn constructor_stores_label_and_info_returns_it() {
    let f = setup();
    assert_eq!(f.client.label(), String::from_str(&f.env, LABEL));
    assert_eq!(f.client.info().label, String::from_str(&f.env, LABEL));
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn constructor_rejects_empty_label() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with_label(&env, "");
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn constructor_rejects_label_over_32_bytes() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with_label(&env, "abcdefghijklmnopqrstuvwxyz0123456"); // 33 bytes
}

#[test]
fn label_of_exactly_32_bytes_is_accepted() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with_label(&env, "abcdefghijklmnopqrstuvwxyz012345"); // 32 bytes
}

#[test]
fn multi_byte_label_of_exactly_32_bytes_is_accepted() {
    // "ç" is 2 UTF-8 bytes, so 16 of them is exactly 32 bytes even though the
    // string is only 16 *chars* -- the contract counts bytes, not chars.
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with_label(&env, "çççççççççççççççç");
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn multi_byte_label_over_32_bytes_is_rejected() {
    // 17 x "ç" is 34 bytes -- over the limit even though it is only 17 chars.
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with_label(&env, "ççççççççççççççççç");
}

#[test]
fn owner_can_rename_and_event_is_exact() {
    let f = setup();
    f.env.mock_all_auths();
    let new = String::from_str(&f.env, "ops-agent");
    f.client.set_label(&new);
    assert_eq!(
        f.env.events().all(),
        std::vec![LabelChanged { label: new.clone() }.to_xdr(&f.env, &f.card)]
    );
    assert_eq!(f.client.label(), new);
}

#[test]
fn set_label_validates() {
    let f = setup();
    f.env.mock_all_auths();
    let too_long = String::from_str(&f.env, "abcdefghijklmnopqrstuvwxyz0123456");
    assert_eq!(
        f.client.try_set_label(&too_long).unwrap_err().unwrap(),
        CardError::InvalidLabel
    );
    let empty = String::from_str(&f.env, "");
    assert_eq!(
        f.client.try_set_label(&empty).unwrap_err().unwrap(),
        CardError::InvalidLabel
    );
    assert_eq!(f.client.label(), String::from_str(&f.env, LABEL));
}

#[test]
#[should_panic(expected = "Auth")]
fn set_label_requires_owner_auth() {
    let f = setup();
    f.client.set_label(&String::from_str(&f.env, "x"));
}

#[test]
fn max_label_len_is_32() {
    assert_eq!(MAX_LABEL_LEN, 32);
}
