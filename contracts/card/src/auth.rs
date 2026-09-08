use soroban_sdk::auth::{Context, CustomAccountInterface};
use soroban_sdk::crypto::Hash;
use soroban_sdk::{contractimpl, symbol_short, Address, BytesN, Env, TryFromVal, Vec};

use crate::policy;
use crate::types::{CardError, DataKey, Sig};
use crate::{Card, CardArgs, CardClient};

#[contractimpl]
impl CustomAccountInterface for Card {
    type Signature = Vec<Sig>;
    type Error = CardError;

    /// Authorization boundary for every action taken *as* the card.
    /// Accepts exactly one agent signature over exactly one context:
    /// `token.transfer(self, to, amount)`. Everything else is rejected.
    /// Must not emit events (x402 facilitator rejects extra events).
    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Vec<Sig>,
        auth_contexts: Vec<Context>,
    ) -> Result<(), CardError> {
        // 1. Exactly one signature, by the configured agent key.
        if signatures.len() != 1 {
            return Err(CardError::BadSignature);
        }
        let sig = signatures.get(0).unwrap();
        let agent: BytesN<32> = env.storage().instance().get(&DataKey::Signer).unwrap();
        if sig.public_key != agent {
            return Err(CardError::BadSignature);
        }
        // Traps (auth failure) if the signature does not verify.
        env.crypto().ed25519_verify(
            &sig.public_key,
            &signature_payload.clone().into(),
            &sig.signature,
        );

        // 2. Exactly one context: token.transfer(self, to, amount).
        if auth_contexts.len() != 1 {
            return Err(CardError::WrongContext);
        }
        let (to, amount) = match auth_contexts.get(0).unwrap() {
            Context::Contract(c) => {
                let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
                if c.contract != token
                    || c.fn_name != symbol_short!("transfer")
                    || c.args.len() != 3
                {
                    return Err(CardError::WrongContext);
                }
                let from = Address::try_from_val(&env, &c.args.get(0).unwrap())
                    .map_err(|_| CardError::WrongContext)?;
                if from != env.current_contract_address() {
                    return Err(CardError::WrongContext);
                }
                let to = Address::try_from_val(&env, &c.args.get(1).unwrap())
                    .map_err(|_| CardError::WrongContext)?;
                let amount = i128::try_from_val(&env, &c.args.get(2).unwrap())
                    .map_err(|_| CardError::WrongContext)?;
                (to, amount)
            }
            _ => return Err(CardError::WrongContext),
        };

        // 3. Policy + accounting.
        policy::enforce_payment(&env, &to, amount)
    }
}
