use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::auth::{
    Context, ContractContext, ContractExecutable, CreateContractHostFnContext,
};
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::{symbol_short, vec, Address, BytesN, Env, IntoVal, Symbol, Val, Vec};

use super::{Fixture, USDC};
use crate::{Card, CardError, Sig};

struct Agent {
    key: SigningKey,
}

impl Agent {
    fn new() -> Self {
        Agent {
            key: SigningKey::generate(&mut rand::thread_rng()),
        }
    }
    fn public_key(&self, env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &self.key.verifying_key().to_bytes())
    }
    fn sigs(&self, env: &Env, payload: &BytesN<32>) -> Vec<Sig> {
        let sig = self.key.sign(&payload.to_array());
        let s = Sig {
            public_key: self.public_key(env),
            signature: BytesN::from_array(env, &sig.to_bytes()),
        };
        vec![env, s]
    }
    fn sign(&self, env: &Env, payload: &BytesN<32>) -> Val {
        self.sigs(env, payload).into_val(env)
    }
}

/// Card fixture whose signer is a real ed25519 key we can sign with.
fn setup_with_agent<'a>() -> (Fixture<'a>, Agent) {
    let env = Env::default();
    soroban_sdk::testutils::Ledger::set_timestamp(&env.ledger(), super::T0);
    let agent = Agent::new();
    let owner = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let agent_pk = agent.public_key(&env);
    let card = env.register(
        Card,
        (
            owner.clone(),
            agent_pk.clone(),
            token.clone(),
            super::default_policy(),
        ),
    );
    let client = crate::CardClient::new(&env, &card);
    (
        Fixture {
            env,
            card,
            client,
            owner,
            agent_pk,
            token,
            token_admin,
        },
        agent,
    )
}

fn payload(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

fn transfer_ctx(
    f: &Fixture,
    contract: &Address,
    fn_name: Symbol,
    from: &Address,
    to: &Address,
    amount: i128,
) -> Vec<Context> {
    vec![
        &f.env,
        Context::Contract(ContractContext {
            contract: contract.clone(),
            fn_name,
            args: vec![
                &f.env,
                from.into_val(&f.env),
                to.into_val(&f.env),
                amount.into_val(&f.env),
            ],
        }),
    ]
}

fn check(f: &Fixture, sig: Val, ctx: &Vec<Context>) -> Result<(), CardError> {
    f.env
        .try_invoke_contract_check_auth::<CardError>(&f.card, &payload(&f.env), sig, ctx)
        .map_err(|e| e.unwrap())
}

fn allowed(f: &Fixture) -> Address {
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    m
}

#[test]
fn accepts_valid_transfer_and_accounts_spend() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(
        &f,
        &f.token,
        symbol_short!("transfer"),
        &f.card,
        &m,
        3 * USDC,
    );
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Ok(())
    );
    assert_eq!(f.client.period().spent, 3 * USDC);
}

#[test]
fn rejects_signature_from_wrong_key() {
    let (f, _agent) = setup_with_agent();
    let m = allowed(&f);
    let impostor = Agent::new();
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, USDC);
    assert_eq!(
        check(&f, impostor.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::BadSignature)
    );
}

#[test]
fn rejects_empty_or_multiple_signatures() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, USDC);
    let none: Vec<Sig> = vec![&f.env];
    assert_eq!(
        check(&f, none.into_val(&f.env), &ctx),
        Err(CardError::BadSignature)
    );

    let one: Vec<Sig> = agent.sigs(&f.env, &payload(&f.env));
    let mut two = one.clone();
    two.push_back(one.get(0).unwrap());
    assert_eq!(
        check(&f, two.into_val(&f.env), &ctx),
        Err(CardError::BadSignature)
    );
}

#[test]
#[should_panic]
fn tampered_signature_bytes_trap() {
    // ed25519_verify traps on an invalid signature; the host turns that into auth failure.
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, USDC);
    let other_payload = BytesN::from_array(&f.env, &[9u8; 32]);
    let _ = check(&f, agent.sign(&f.env, &other_payload), &ctx);
}

#[test]
fn rejects_approve_context() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("approve"), &f.card, &m, USDC);
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::WrongContext)
    );
}

#[test]
fn rejects_other_token_contract() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let other = Address::generate(&f.env);
    let ctx = transfer_ctx(&f, &other, symbol_short!("transfer"), &f.card, &m, USDC);
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::WrongContext)
    );
}

#[test]
fn rejects_transfer_from_someone_else() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let someone = Address::generate(&f.env);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &someone, &m, USDC);
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::WrongContext)
    );
}

#[test]
fn rejects_transfer_with_four_args() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, USDC);
    // `transfer_from(spender, from, to, amount)` shape: same name, one extra arg.
    let four = match ctx.get(0).unwrap() {
        Context::Contract(c) => {
            let mut args = c.args.clone();
            args.push_back(m.into_val(&f.env));
            vec![
                &f.env,
                Context::Contract(ContractContext {
                    contract: c.contract.clone(),
                    fn_name: c.fn_name,
                    args,
                }),
            ]
        }
        _ => unreachable!(),
    };
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &four),
        Err(CardError::WrongContext)
    );
}

#[test]
fn rejects_non_contract_context() {
    let (f, agent) = setup_with_agent();
    let ctx: Vec<Context> = vec![
        &f.env,
        Context::CreateContractHostFn(CreateContractHostFnContext {
            executable: ContractExecutable::Wasm(BytesN::from_array(&f.env, &[3u8; 32])),
            salt: BytesN::from_array(&f.env, &[4u8; 32]),
        }),
    ];
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::WrongContext)
    );
}

#[test]
fn rejects_multiple_contexts() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let mut ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, USDC);
    ctx.push_back(ctx.get(0).unwrap());
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::WrongContext)
    );
}

#[test]
fn rejects_empty_contexts() {
    let (f, agent) = setup_with_agent();
    let ctx: Vec<Context> = vec![&f.env];
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::WrongContext)
    );
}

#[test]
fn policy_errors_propagate() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(
        &f,
        &f.token,
        symbol_short!("transfer"),
        &f.card,
        &m,
        11 * USDC,
    );
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::OverPerTxCap)
    );
}

#[test]
fn check_auth_emits_no_events() {
    // The test env's event log reflects only the most recent top-level
    // invocation, so it is checked right after `check()` (a distinct
    // invocation from `allowed()`'s add_merchant call) rather than diffed
    // against a snapshot taken before it.
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, USDC);
    assert_eq!(
        check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx),
        Ok(())
    );
    assert_eq!(f.env.events().all().events().len(), 0);
}
