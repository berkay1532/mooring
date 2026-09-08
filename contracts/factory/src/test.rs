#![cfg(test)]

extern crate std;

use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{vec, Address, BytesN, Env, Event, IntoVal, Map, Symbol, Val};

use crate::{card, CardCreated, Factory, FactoryClient};

const T0: u64 = 1_000;
const DAY: u64 = 86_400;
const USDC: i128 = 10_000_000;

fn policy() -> card::Policy {
    card::Policy {
        period_amount: 50 * USDC,
        period_duration: DAY,
        max_per_tx: 10 * USDC,
        expiry: T0 + 30 * DAY,
    }
}

#[test]
fn creates_card_with_deterministic_address_and_event() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    env.mock_all_auths();

    let wasm_hash = env.deployer().upload_contract_wasm(card::WASM);
    let factory_id = env.register(Factory, (wasm_hash.clone(),));
    let factory = FactoryClient::new(&env, &factory_id);
    assert_eq!(factory.card_wasm_hash(), wasm_hash);

    let owner = Address::generate(&env);
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    let signer = BytesN::from_array(&env, &[3u8; 32]);
    let salt = BytesN::from_array(&env, &[42u8; 32]);

    let expected = env
        .deployer()
        .with_address(factory_id.clone(), salt.clone())
        .deployed_address();

    let card_addr = factory.create_card(&owner, &signer, &token, &policy(), &salt);
    assert_eq!(card_addr, expected);

    assert_eq!(
        env.events().all(),
        std::vec![CardCreated {
            owner: owner.clone(),
            card: card_addr.clone()
        }
        .to_xdr(&env, &factory_id)]
    );

    let c = card::Client::new(&env, &card_addr);
    assert_eq!(c.owner(), owner);
    assert_eq!(c.signer(), signer);
    assert_eq!(c.token(), token);
    assert_eq!(c.policy(), policy());
}

#[test]
#[should_panic]
fn same_salt_twice_fails() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    env.mock_all_auths();
    let wasm_hash = env.deployer().upload_contract_wasm(card::WASM);
    let factory = FactoryClient::new(&env, &env.register(Factory, (wasm_hash,)));
    let owner = Address::generate(&env);
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    let signer = BytesN::from_array(&env, &[3u8; 32]);
    let salt = BytesN::from_array(&env, &[1u8; 32]);
    factory.create_card(&owner, &signer, &token, &policy(), &salt);
    factory.create_card(&owner, &signer, &token, &policy(), &salt);
}

#[test]
fn card_created_indexes_the_owner_as_a_topic() {
    // The app subscribes to `card_created` per owner, so the owner address
    // must be a topic rather than part of the event body.
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    env.mock_all_auths();
    let wasm_hash = env.deployer().upload_contract_wasm(card::WASM);
    let factory_id = env.register(Factory, (wasm_hash,));
    let factory = FactoryClient::new(&env, &factory_id);
    let owner = Address::generate(&env);
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    let signer = BytesN::from_array(&env, &[3u8; 32]);

    let card = factory.create_card(
        &owner,
        &signer,
        &token,
        &policy(),
        &BytesN::from_array(&env, &[7u8; 32]),
    );

    assert_eq!(
        env.events().all().filter_by_contract(&factory_id),
        vec![
            &env,
            (
                factory_id.clone(),
                vec![
                    &env,
                    Symbol::new(&env, "card_created").into_val(&env),
                    owner.into_val(&env),
                ],
                Map::<Symbol, Val>::from_array(
                    &env,
                    [(Symbol::new(&env, "card"), card.into_val(&env))]
                )
                .into_val(&env),
            )
        ]
    );
}
