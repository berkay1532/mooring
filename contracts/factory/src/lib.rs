#![no_std]

use soroban_sdk::xdr::ToXdr as _;
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, Bytes, BytesN, Env,
};

#[cfg(test)]
mod test;

/// Card contract bindings (types + client) generated from the built WASM.
/// Build the card first: `cargo build -p mooring-card --target wasm32v1-none --release`.
pub mod card {
    // The imported spec declares `__check_auth`, whose signature mentions
    // `soroban_sdk::auth::Context`; the generated bindings reference it
    // unqualified, so it has to be in scope here.
    use soroban_sdk::auth::Context;
    soroban_sdk::contractimport!(file = "../../target/wasm32v1-none/release/mooring_card.wasm");
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    CardWasmHash,
}

/// `owner` is a topic so the app can subscribe to one user's cards.
#[contractevent(topics = ["card_created"])]
pub struct CardCreated {
    #[topic]
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
    ///
    /// The deploy salt is `sha256(owner_xdr || salt)`, so the resulting address
    /// is deterministic from `(factory, owner, salt)`. Binding it to the owner
    /// means a `salt` another user is about to use cannot be front-run, and it
    /// lets the app enumerate one owner's cards from a salt it chose.
    /// Emits `card_created`.
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
        let mut preimage = owner.clone().to_xdr(&env);
        preimage.append(&Bytes::from_array(&env, &salt.to_array()));
        let deploy_salt = env.crypto().sha256(&preimage).to_bytes();
        let card = env
            .deployer()
            .with_current_contract(deploy_salt)
            .deploy_v2(wasm_hash, (owner.clone(), signer, token, policy));
        CardCreated {
            owner,
            card: card.clone(),
        }
        .publish(&env);
        // The new card's own constructor already extends its instance and code
        // TTL (`Storage::instance().extend_ttl` resolves to the host's
        // `extend_current_contract_instance_and_code_ttl`), so no
        // `extend_ttl_for_code` is needed here -- see the factory test
        // `created_card_starts_with_instance_and_code_ttl_extended`. This call
        // covers the *factory's* own instance and code.
        env.storage().instance().extend_ttl(17_280, 518_400);
        card
    }
}
