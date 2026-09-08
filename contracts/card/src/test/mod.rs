#![cfg(test)]

mod allowlist;
mod auth;
mod constructor;
mod owner;
mod policy;

use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, BytesN, Env};

use crate::{Card, CardClient, Policy};

pub const T0: u64 = 1_000;
pub const DAY: u64 = 86_400;
pub const USDC: i128 = 10_000_000; // 1 USDC in 7-decimal base units

pub struct Fixture<'a> {
    pub env: Env,
    pub card: Address,
    pub client: CardClient<'a>,
    pub owner: Address,
    pub agent_pk: BytesN<32>,
    pub token: Address,
    // Reserved for later tasks (e.g. re-minting mid-test); not read yet.
    #[allow(dead_code)]
    pub token_admin: Address,
}

pub fn default_policy() -> Policy {
    Policy {
        period_amount: 50 * USDC,
        period_duration: DAY,
        max_per_tx: 10 * USDC,
        expiry: T0 + 30 * DAY,
    }
}

/// Registers a SAC token and a card with `default_policy()` at ledger time T0.
pub fn setup<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.ledger().set_timestamp(T0);

    let owner = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let agent_pk = BytesN::from_array(&env, &[1u8; 32]);

    let card = env.register(
        Card,
        (
            owner.clone(),
            agent_pk.clone(),
            token.clone(),
            default_policy(),
        ),
    );
    let client = CardClient::new(&env, &card);

    Fixture {
        env,
        card,
        client,
        owner,
        agent_pk,
        token,
        token_admin,
    }
}

/// Mints `amount` of the fixture token to the card (admin auth mocked).
pub fn fund_card(f: &Fixture, amount: i128) {
    f.env.mock_all_auths();
    token::StellarAssetClient::new(&f.env, &f.token).mint(&f.card, &amount);
}
