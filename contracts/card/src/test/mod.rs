#![cfg(test)]

use soroban_sdk::Env;

use crate::{Card, CardClient};

#[test]
fn smoke_version() {
    let env = Env::default();
    let id = env.register(Card, ());
    let client = CardClient::new(&env, &id);
    assert_eq!(client.version(), 1);
}
