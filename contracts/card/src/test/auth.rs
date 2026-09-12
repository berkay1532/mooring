extern crate std;

use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::auth::{
    Context, ContractContext, ContractExecutable, CreateContractHostFnContext,
};
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::xdr::{self, WriteXdr};
use soroban_sdk::{
    symbol_short, token, vec, Address, Bytes, BytesN, Env, IntoVal, Symbol, TryFromVal, Val, Vec,
};

use super::{Fixture, USDC};
use crate::{Card, CardError, Sig};
use soroban_sdk::InvokeError;

pub(super) struct Agent {
    key: SigningKey,
}

impl Agent {
    pub(super) fn new() -> Self {
        Agent {
            key: SigningKey::generate(&mut rand::thread_rng()),
        }
    }
    pub(super) fn public_key(&self, env: &Env) -> BytesN<32> {
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
    pub(super) fn sign(&self, env: &Env, payload: &BytesN<32>) -> Val {
        self.sigs(env, payload).into_val(env)
    }
}

/// Card fixture whose signer is a real ed25519 key we can sign with.
pub(super) fn setup_with_agent<'a>() -> (Fixture<'a>, Agent) {
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

pub(super) fn payload(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

pub(super) fn transfer_ctx(
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

/// Raw `__check_auth` result: the outer `Err` is either a contract error the
/// card returned, or an `InvokeError` when the host trapped (e.g. a failed
/// `ed25519_verify`).
pub(super) fn check_raw(
    f: &Fixture,
    sig: Val,
    ctx: &Vec<Context>,
) -> Result<(), Result<CardError, InvokeError>> {
    f.env
        .try_invoke_contract_check_auth::<CardError>(&f.card, &payload(&f.env), sig, ctx)
}

/// `check_raw` for the cases that must return a contract error; panics if the
/// host trapped instead.
pub(super) fn check(f: &Fixture, sig: Val, ctx: &Vec<Context>) -> Result<(), CardError> {
    check_raw(f, sig, ctx).map_err(|e| e.unwrap())
}

pub(super) fn allowed(f: &Fixture) -> Address {
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
fn signature_over_the_wrong_payload_traps() {
    // `ed25519_verify` traps rather than returning; the host turns the trap
    // into an aborted invocation, which the caller sees as an auth failure.
    // Asserted on the inner result so a panic from anywhere else cannot pass.
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, USDC);
    let other_payload = BytesN::from_array(&f.env, &[9u8; 32]);
    assert_eq!(
        check_raw(&f, agent.sign(&f.env, &other_payload), &ctx),
        Err(Err(InvokeError::Abort))
    );
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

#[test]
fn rotated_signer_replaces_old_agent() {
    let (f, old_agent) = setup_with_agent();
    let m = allowed(&f);
    let new_agent = Agent::new();
    f.client.set_signer(&new_agent.public_key(&f.env));

    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, USDC);
    assert_eq!(
        check(&f, old_agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::BadSignature)
    );
    assert_eq!(
        check(&f, new_agent.sign(&f.env, &payload(&f.env)), &ctx),
        Ok(())
    );
}

// ---- host-driven auth entry (the real x402 payment path) ----
//
// The tests above call `__check_auth` directly. This one goes through the
// host: it hand-builds the `SorobanAuthorizationEntry` a facilitator would
// submit -- address credentials for the card, a nonce, an expiration ledger,
// and a signature over sha256(HashIdPreimage::SorobanAuthorization) -- installs
// it with `set_auths`, and then invokes the SAC's `transfer` as any caller
// would. Nothing is mocked, so it proves the on-chain wiring end to end.

fn auth_entry(
    f: &Fixture,
    agent: &Agent,
    to: &Address,
    amount: i128,
    nonce: i64,
) -> xdr::SorobanAuthorizationEntry {
    let env = &f.env;
    let expiration = env.ledger().sequence() + 100;

    let invocation = xdr::SorobanAuthorizedInvocation {
        function: xdr::SorobanAuthorizedFunction::ContractFn(xdr::InvokeContractArgs {
            contract_address: sc_address(&f.token),
            function_name: xdr::ScSymbol("transfer".try_into().unwrap()),
            args: std::vec![
                to_sc_val(env, &f.card),
                to_sc_val(env, to),
                to_sc_val(env, &amount),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: std::vec::Vec::new().try_into().unwrap(),
    };

    let preimage =
        xdr::HashIdPreimage::SorobanAuthorization(xdr::HashIdPreimageSorobanAuthorization {
            network_id: xdr::Hash(env.ledger().network_id().to_array()),
            nonce,
            signature_expiration_ledger: expiration,
            invocation: invocation.clone(),
        });
    let payload = env
        .crypto()
        .sha256(&Bytes::from_slice(
            env,
            &preimage.to_xdr(xdr::Limits::none()).unwrap(),
        ))
        .to_bytes();

    xdr::SorobanAuthorizationEntry {
        credentials: xdr::SorobanCredentials::Address(xdr::SorobanAddressCredentials {
            address: sc_address(&f.card),
            nonce,
            signature_expiration_ledger: expiration,
            signature: to_sc_val(env, &agent.sigs(env, &payload)),
        }),
        root_invocation: invocation,
    }
}

fn sc_address(a: &Address) -> xdr::ScAddress {
    let env = a.env().clone();
    match to_sc_val(&env, a) {
        xdr::ScVal::Address(sa) => sa,
        _ => unreachable!("Address always converts to ScVal::Address"),
    }
}

fn to_sc_val<T: Clone + IntoVal<Env, Val>>(env: &Env, v: &T) -> xdr::ScVal {
    let val: Val = v.clone().into_val(env);
    xdr::ScVal::try_from_val(env, &val).unwrap()
}

#[test]
fn host_authorizes_a_real_sac_transfer_and_accounts_the_spend() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    super::fund_card(&f, 20 * USDC);

    let entry = auth_entry(&f, &agent, &m, 3 * USDC, 1);
    f.env.set_auths(&[entry]);

    token::Client::new(&f.env, &f.token).transfer(&f.card, &m, &(3 * USDC));

    assert_eq!(token::Client::new(&f.env, &f.token).balance(&m), 3 * USDC);
    assert_eq!(f.client.balance(), 17 * USDC);
    assert_eq!(f.client.period().spent, 3 * USDC);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn host_rejects_a_transfer_to_an_unlisted_merchant() {
    // Same path as above, but the policy denies it: NotAllowlisted (#6)
    // surfaces from `__check_auth` as an auth failure at the host level.
    let (f, agent) = setup_with_agent();
    super::fund_card(&f, 20 * USDC);
    let stranger = Address::generate(&f.env);

    let entry = auth_entry(&f, &agent, &stranger, USDC, 2);
    f.env.set_auths(&[entry]);

    token::Client::new(&f.env, &f.token).transfer(&f.card, &stranger, &USDC);
}
