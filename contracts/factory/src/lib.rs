#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, BytesN, Env};

#[cfg(test)]
mod test;

/// Card contract bindings (types + client) generated from the built WASM.
/// Build the card first: `cargo build -p mooring-card --target wasm32v1-none --release`.
pub mod card {
    use soroban_sdk::auth::Context;
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/mooring_card.wasm");
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    CardWasmHash,
}

#[contractevent(topics = ["card_created"])]
pub struct CardCreated {
    pub owner: Address,
    pub card: Address,
}

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    pub fn __constructor(env: Env, card_wasm_hash: BytesN<32>) {
        env.storage()
            .instance()
            .set(&DataKey::CardWasmHash, &card_wasm_hash);
    }

    pub fn card_wasm_hash(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .get(&DataKey::CardWasmHash)
            .unwrap()
    }

    /// Deploys a new card owned by `owner` with agent key `signer`.
    /// Address is deterministic from (factory, salt). Emits `card_created`.
    pub fn create_card(
        env: Env,
        owner: Address,
        signer: BytesN<32>,
        token: Address,
        policy: card::Policy,
        salt: BytesN<32>,
    ) -> Address {
        owner.require_auth();
        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::CardWasmHash)
            .unwrap();
        let card = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, (owner.clone(), signer, token, policy));
        CardCreated {
            owner,
            card: card.clone(),
        }
        .publish(&env);
        env.storage().instance().extend_ttl(17_280, 518_400);
        card
    }
}
