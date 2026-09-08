# D1 — Spending-policy Card Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Mooring card as a Soroban custom account that holds a SEP-41 token and enforces a periodic budget, per-tx cap, merchant allowlist, expiry and freeze/cancel inside `__check_auth`, with owner-mutable policy and signer, plus a factory, a testnet deployment, and on-chain evidence of one accepted and one rejected payment.

**Architecture:** Two Rust contracts in a Cargo workspace. `mooring-card` implements `CustomAccountInterface`; every agent payment is a plain `token.transfer(card, merchant, amount)` whose auth entry the card validates (signature + a strict single-context allow-list + policy) and accounts for (`spent`). Owner operations (freeze/cancel/withdraw, allowlist, policy update, signer rotation) are ordinary entrypoints guarded by `owner.require_auth()`; card code has no upgrade path. `mooring-factory` deploys cards via `deploy_v2` and emits `card_created`. A small TypeScript script signs card auth entries with the agent key (the stock `@x402/stellar` client cannot) and produces the testnet evidence.

**Tech Stack:** Rust + `soroban-sdk` 25 (contracts, tests with `testutils`, `ed25519-dalek` for test signatures) · `stellar` CLI (build/deploy) · Node 20 + `@stellar/stellar-sdk` 17 + `tsx` (evidence scripts) · GitHub Actions.

**Spec:** `docs/design.md` and `docs/spike-w1-auth-mechanism.md` (the spike note is normative for `__check_auth`).

## Global Constraints

- Repo language: **English only** (code, comments, docs, commits).
- All code is net-new Stellar code. Never copy from or reference any non-Stellar project.
- License: **Apache-2.0**. Network: **testnet only**.
- `soroban-sdk = "25.0.1"` (pin exactly; `testutils` feature only in dev-dependencies).
- `__check_auth` **emits no events** and accepts **exactly one** auth context of the form `token.transfer(self, to, amount)`.
- Budget **resets** each period; unused budget never carries over.
- Token amounts are `i128` in 7-decimal base units (1 USDC = `10_000_000`).
- Timestamps are `u64` unix seconds from `env.ledger().timestamp()`.
- Every storage-writing entrypoint extends instance TTL (`threshold 17_280`, `extend_to 518_400`).
- Allowlist max size: **32** merchants.
- Card code is immutable (no `upgrade` entrypoint). Policy, signer and allowlist are owner-mutable.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
- Work on a branch off `main` (e.g. `feat/d1-card-contract`). Commit after every task; never push unless the owner asks.

## File Structure

```
Cargo.toml                          workspace: members, shared deps, release profile
Makefile                            build / test / fmt shortcuts (same commands CI runs)
LICENSE                             Apache-2.0
.github/workflows/ci.yml            fmt check, wasm build, cargo test
contracts/card/Cargo.toml
contracts/card/src/lib.rs           #[contract] Card, constructor, getters, owner ops, set_policy/set_signer, bump, TTL helper
contracts/card/src/types.rs         State, Policy, Period, Sig, DataKey, CardError
contracts/card/src/allowlist.rs     add / remove / is_allowed (persistent keys + bounded count)
contracts/card/src/policy.rs        validate(), current_period(), enforce_payment(), remaining() — the policy engine
contracts/card/src/auth.rs          CustomAccountInterface::__check_auth
contracts/card/src/test/mod.rs      test module root + shared setup()
contracts/card/src/test/constructor.rs
contracts/card/src/test/allowlist.rs
contracts/card/src/test/policy.rs
contracts/card/src/test/auth.rs
contracts/card/src/test/owner.rs
contracts/card/src/test/update.rs      set_policy / set_signer
contracts/factory/Cargo.toml
contracts/factory/src/lib.rs        Factory: constructor, create_card, card_wasm_hash
contracts/factory/src/test.rs
scripts/testnet/deploy.sh           build, upload card wasm, deploy factory, create card
scripts/testnet/fund.sh             SAC transfer of USDC from funder to card
scripts/agent/package.json          node deps for evidence scripts
scripts/agent/tsconfig.json
scripts/agent/src/card-signer.ts    authorizeEntry-based signer: address = card, key = agent
scripts/agent/src/common.ts         env loading, rpc client, helpers
scripts/agent/src/pay.ts            one card-paid transfer; prints minResourceFee + tx hash
scripts/agent/src/race.ts           two overlapping payments → second FAILS on-chain (rejection evidence)
docs/testnet.md                     deployed addresses + evidence tx hashes (filled by Tasks 8–9)
```

---

### Task 1: Workspace scaffold, CI, license

**Files:**
- Create: `Cargo.toml`, `Makefile`, `LICENSE`, `.github/workflows/ci.yml`, `rust-toolchain.toml`
- Create: `contracts/card/Cargo.toml`, `contracts/card/src/lib.rs`, `contracts/card/src/test/mod.rs`
- Modify: `.gitignore` (add `scripts/agent/node_modules`, `scripts/agent/.env`)

**Interfaces:**
- Produces: a workspace where `make build` produces `target/wasm32v1-none/release/mooring_card.wasm` and `make test` runs all tests.

- [ ] **Step 1: Create the workspace `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = ["contracts/card", "contracts/factory"]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "Apache-2.0"
repository = "https://github.com/berkay1532/mooring"

[workspace.dependencies]
soroban-sdk = "25.0.1"

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true

[profile.release-with-logs]
inherits = "release"
debug-assertions = true
```

Until Task 8 creates `contracts/factory`, temporarily set `members = ["contracts/card"]`. Task 8 adds the factory member.

- [ ] **Step 2: Pin the toolchain**

`rust-toolchain.toml`:
```toml
[toolchain]
channel = "1.89"
targets = ["wasm32v1-none"]
components = ["rustfmt", "clippy"]
```

If `rustup target add wasm32v1-none` is unavailable on the installed toolchain, run `rustup update` first; `wasm32v1-none` is the target `stellar contract build` uses on Rust ≥ 1.85.

- [ ] **Step 3: Create the card crate skeleton**

`contracts/card/Cargo.toml`:
```toml
[package]
name = "mooring-card"
version.workspace = true
edition.workspace = true
license.workspace = true
publish = false

[lib]
crate-type = ["cdylib", "lib"]
doctest = false

[dependencies]
soroban-sdk = { workspace = true }

[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
ed25519-dalek = { version = "2", features = ["rand_core"] }
rand = "0.8"
```

`contracts/card/src/lib.rs`:
```rust
#![no_std]

use soroban_sdk::{contract, contractimpl, Env};

#[cfg(test)]
mod test;

#[contract]
pub struct Card;

#[contractimpl]
impl Card {
    /// Temporary smoke entrypoint; replaced in Task 2.
    pub fn version(_env: Env) -> u32 {
        1
    }
}
```

`contracts/card/src/test/mod.rs`:
```rust
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
```

- [ ] **Step 4: Makefile**

```makefile
.PHONY: build test fmt lint clean

build:
	cargo build -p mooring-card --target wasm32v1-none --release
	cargo build -p mooring-factory --target wasm32v1-none --release || true

test: build
	cargo test --workspace

fmt:
	cargo fmt --all

lint:
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings

clean:
	cargo clean
```

(The `|| true` on the factory line exists only until Task 8 adds the crate; Task 8 removes it.)

- [ ] **Step 5: CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: "1.89"
          targets: wasm32v1-none
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all -- --check
      - run: cargo build -p mooring-card --target wasm32v1-none --release
      - run: cargo test --workspace
      - run: cargo clippy --workspace --all-targets -- -D warnings
```

- [ ] **Step 6: License and gitignore**

Write the full Apache-2.0 text to `LICENSE` (copy verbatim from https://www.apache.org/licenses/LICENSE-2.0.txt; copyright line `Copyright 2026 Berkay Gündüz`).

Append to `.gitignore`:
```
# scripts
scripts/agent/node_modules
scripts/agent/.env
```

- [ ] **Step 7: Run build and test**

Run: `make build && cargo test --workspace`
Expected: build produces `target/wasm32v1-none/release/mooring_card.wasm`; `smoke_version` PASS.

- [ ] **Step 8: Commit**

```bash
git checkout -b feat/d1-card-contract
git add Cargo.toml Makefile LICENSE rust-toolchain.toml .github .gitignore contracts docs README.md CLAUDE.md
git commit -m "chore: workspace scaffold, CI, Apache-2.0 license

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(This first commit also captures the existing README, CLAUDE.md and docs, which were untracked.)

---

### Task 2: Types, constructor, getters

**Files:**
- Create: `contracts/card/src/types.rs`
- Modify: `contracts/card/src/lib.rs` (replace smoke entrypoint)
- Create: `contracts/card/src/test/constructor.rs`
- Modify: `contracts/card/src/test/mod.rs` (shared setup, remove smoke test)

**Interfaces:**
- Produces:
  - `Policy { period_amount: i128, period_duration: u64, max_per_tx: i128, expiry: u64 }`
  - `Period { start: u64, spent: i128 }`
  - `State { Active, Frozen, Cancelled }`
  - `Sig { public_key: BytesN<32>, signature: BytesN<64> }`
  - `DataKey { Owner, Signer, Token, Policy, Period, State, AllowCount, Allowed(Address) }`
  - `CardError` (u32 codes 1–12, listed below)
  - `Card::__constructor(env, owner: Address, signer: BytesN<32>, token: Address, policy: Policy)`
  - Getters: `owner() -> Address`, `signer() -> BytesN<32>`, `token() -> Address`, `policy() -> Policy`, `state() -> State`, `period() -> Period`, `balance() -> i128`
  - `pub(crate) fn extend_instance(env: &Env)`
  - Test helper `test::setup() -> Fixture` (see below)

- [ ] **Step 1: Write `types.rs`**

```rust
use soroban_sdk::{contracterror, contracttype, Address, BytesN};

/// Lifecycle state of a card.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum State {
    Active = 0,
    Frozen = 1,
    Cancelled = 2,
}

/// Immutable spending policy set at creation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    /// Max total spend per period, in token base units.
    pub period_amount: i128,
    /// Period length in seconds.
    pub period_duration: u64,
    /// Max amount for a single payment, in token base units.
    pub max_per_tx: i128,
    /// Unix timestamp after which no payment is authorized.
    pub expiry: u64,
}

/// Mutable accounting for the current period.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Period {
    pub start: u64,
    pub spent: i128,
}

/// One ed25519 signature as encoded by stellar-sdk `authorizeEntry`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Sig {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    Signer,
    Token,
    Policy,
    Period,
    State,
    AllowCount,
    Allowed(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CardError {
    BadSignature = 1,
    WrongContext = 2,
    Frozen = 3,
    Cancelled = 4,
    Expired = 5,
    NotAllowlisted = 6,
    OverPerTxCap = 7,
    OverBudget = 8,
    InvalidAmount = 9,
    AllowlistFull = 10,
    InvalidPolicy = 11,
    InvalidState = 12,
}
```

- [ ] **Step 2: Write the failing constructor/getter tests**

`contracts/card/src/test/mod.rs` (replace entirely):
```rust
#![cfg(test)]

mod constructor;

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
    let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let agent_pk = BytesN::from_array(&env, &[1u8; 32]);

    let card = env.register(
        Card,
        (owner.clone(), agent_pk.clone(), token.clone(), default_policy()),
    );
    let client = CardClient::new(&env, &card);

    Fixture { env, card, client, owner, agent_pk, token, token_admin }
}

/// Mints `amount` of the fixture token to the card (admin auth mocked).
pub fn fund_card(f: &Fixture, amount: i128) {
    f.env.mock_all_auths();
    token::StellarAssetClient::new(&f.env, &f.token).mint(&f.card, &amount);
}
```

`contracts/card/src/test/constructor.rs`:
```rust
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::{Address, BytesN, Env};
use soroban_sdk::testutils::Address as _;

use super::{default_policy, fund_card, setup, DAY, T0, USDC};
use crate::{Card, Period, Policy, State};

#[test]
fn constructor_stores_config_and_starts_active() {
    let f = setup();
    assert_eq!(f.client.owner(), f.owner);
    assert_eq!(f.client.signer(), f.agent_pk);
    assert_eq!(f.client.token(), f.token);
    assert_eq!(f.client.policy(), default_policy());
    assert_eq!(f.client.state(), State::Active);
    assert_eq!(f.client.period(), Period { start: T0, spent: 0 });
}

#[test]
fn balance_reflects_token_holdings() {
    let f = setup();
    assert_eq!(f.client.balance(), 0);
    fund_card(&f, 25 * USDC);
    assert_eq!(f.client.balance(), 25 * USDC);
}

fn register_with(env: &Env, policy: Policy) {
    let owner = Address::generate(env);
    let admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    env.register(Card, (owner, BytesN::from_array(env, &[1u8; 32]), token, policy));
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_zero_period_amount() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with(&env, Policy { period_amount: 0, ..default_policy() });
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_zero_duration() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with(&env, Policy { period_duration: 0, ..default_policy() });
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_per_tx_cap_above_budget() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with(&env, Policy { max_per_tx: 60 * USDC, ..default_policy() });
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_past_expiry() {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    register_with(&env, Policy { expiry: T0, ..default_policy() });
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn constructor_rejects_nonpositive_per_tx_cap() {
    let env = Env::default();
    env.ledger().set_timestamp(T0 + DAY);
    register_with(&env, Policy { max_per_tx: 0, expiry: T0 + 2 * DAY, ..default_policy() });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p mooring-card`
Expected: compile error — `Policy`, `State`, `Period`, constructor and getters do not exist.

- [ ] **Step 4: Implement constructor and getters in `lib.rs`**

Replace `contracts/card/src/lib.rs` entirely:
```rust
#![no_std]

mod types;

#[cfg(test)]
mod test;

pub use types::*;

use soroban_sdk::{contract, contractimpl, panic_with_error, token, Address, BytesN, Env};

/// Extend instance TTL when below ~1 day, up to ~30 days (5s ledgers).
pub(crate) const INSTANCE_TTL_THRESHOLD: u32 = 17_280;
pub(crate) const INSTANCE_TTL_EXTEND_TO: u32 = 518_400;

pub(crate) fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

#[contract]
pub struct Card;

#[contractimpl]
impl Card {
    /// Deploy-time initialization. Runs exactly once (constructor semantics).
    pub fn __constructor(env: Env, owner: Address, signer: BytesN<32>, token: Address, policy: Policy) {
        let now = env.ledger().timestamp();
        if policy.period_amount <= 0
            || policy.period_duration == 0
            || policy.max_per_tx <= 0
            || policy.max_per_tx > policy.period_amount
            || policy.expiry <= now
        {
            panic_with_error!(&env, CardError::InvalidPolicy);
        }
        let s = env.storage().instance();
        s.set(&DataKey::Owner, &owner);
        s.set(&DataKey::Signer, &signer);
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Policy, &policy);
        s.set(&DataKey::Period, &Period { start: now, spent: 0 });
        s.set(&DataKey::State, &State::Active);
        s.set(&DataKey::AllowCount, &0u32);
        extend_instance(&env);
    }

    pub fn owner(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    pub fn signer(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::Signer).unwrap()
    }

    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }

    pub fn policy(env: Env) -> Policy {
        env.storage().instance().get(&DataKey::Policy).unwrap()
    }

    pub fn state(env: Env) -> State {
        env.storage().instance().get(&DataKey::State).unwrap()
    }

    /// Raw stored period (may be stale if a period boundary has passed).
    pub fn period(env: Env) -> Period {
        env.storage().instance().get(&DataKey::Period).unwrap()
    }

    /// Token balance held by this card.
    pub fn balance(env: Env) -> i128 {
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).balance(&env.current_contract_address())
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p mooring-card`
Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add contracts/card
git commit -m "feat(card): types, constructor validation, getters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Merchant allowlist

**Files:**
- Create: `contracts/card/src/allowlist.rs`
- Modify: `contracts/card/src/lib.rs` (add `mod allowlist;`, `add_merchant`, `remove_merchant`, `is_allowed`, `allow_count`, `require_owner`)
- Create: `contracts/card/src/test/allowlist.rs`
- Modify: `contracts/card/src/test/mod.rs` (add `mod allowlist;`)

**Interfaces:**
- Consumes: `DataKey::{Allowed, AllowCount, Owner}`, `CardError::{AllowlistFull}`, `extend_instance`.
- Produces:
  - `pub(crate) fn allowlist::is_allowed(env: &Env, merchant: &Address) -> bool`
  - `pub(crate) fn allowlist::add(env: &Env, merchant: &Address) -> Result<(), CardError>`
  - `pub(crate) fn allowlist::remove(env: &Env, merchant: &Address)`
  - `pub(crate) fn require_owner(env: &Env)` in `lib.rs`
  - Entrypoints: `add_merchant(merchant: Address) -> Result<(), CardError>`, `remove_merchant(merchant: Address)`, `is_allowed(merchant: Address) -> bool`, `allow_count() -> u32`
  - `pub const MAX_ALLOWLIST: u32 = 32`

- [ ] **Step 1: Write the failing tests**

`contracts/card/src/test/allowlist.rs`:
```rust
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

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
```

Add `mod allowlist;` under `mod constructor;` in `test/mod.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p mooring-card allowlist`
Expected: compile error — `add_merchant`, `MAX_ALLOWLIST` not found.

- [ ] **Step 3: Implement `allowlist.rs`**

```rust
use soroban_sdk::{Address, Env};

use crate::types::{CardError, DataKey};
use crate::MAX_ALLOWLIST;

/// Persistent keys get a long TTL; the instance extension covers the rest.
const ALLOWED_TTL_THRESHOLD: u32 = 17_280;
const ALLOWED_TTL_EXTEND_TO: u32 = 518_400;

fn count(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::AllowCount).unwrap_or(0)
}

fn set_count(env: &Env, n: u32) {
    env.storage().instance().set(&DataKey::AllowCount, &n);
}

pub(crate) fn is_allowed(env: &Env, merchant: &Address) -> bool {
    env.storage().persistent().has(&DataKey::Allowed(merchant.clone()))
}

pub(crate) fn add(env: &Env, merchant: &Address) -> Result<(), CardError> {
    let key = DataKey::Allowed(merchant.clone());
    let p = env.storage().persistent();
    if p.has(&key) {
        p.extend_ttl(&key, ALLOWED_TTL_THRESHOLD, ALLOWED_TTL_EXTEND_TO);
        return Ok(());
    }
    let n = count(env);
    if n >= MAX_ALLOWLIST {
        return Err(CardError::AllowlistFull);
    }
    p.set(&key, &true);
    p.extend_ttl(&key, ALLOWED_TTL_THRESHOLD, ALLOWED_TTL_EXTEND_TO);
    set_count(env, n + 1);
    Ok(())
}

pub(crate) fn remove(env: &Env, merchant: &Address) {
    let key = DataKey::Allowed(merchant.clone());
    let p = env.storage().persistent();
    if p.has(&key) {
        p.remove(&key);
        set_count(env, count(env).saturating_sub(1));
    }
}
```

- [ ] **Step 4: Wire entrypoints in `lib.rs`**

Add `mod allowlist;` after `mod types;`, add `pub const MAX_ALLOWLIST: u32 = 32;` after the TTL constants, add:

```rust
pub(crate) fn require_owner(env: &Env) {
    let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
    owner.require_auth();
}
```

and inside `#[contractimpl] impl Card` (after `balance`):
```rust
    /// Owner: allow payments to `merchant`. Idempotent. Bounded by MAX_ALLOWLIST.
    pub fn add_merchant(env: Env, merchant: Address) -> Result<(), CardError> {
        require_owner(&env);
        allowlist::add(&env, &merchant)?;
        extend_instance(&env);
        Ok(())
    }

    /// Owner: disallow payments to `merchant`. No-op if absent.
    pub fn remove_merchant(env: Env, merchant: Address) {
        require_owner(&env);
        allowlist::remove(&env, &merchant);
        extend_instance(&env);
    }

    pub fn is_allowed(env: Env, merchant: Address) -> bool {
        allowlist::is_allowed(&env, &merchant)
    }

    pub fn allow_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::AllowCount).unwrap_or(0)
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p mooring-card`
Expected: all PASS (13 tests).

- [ ] **Step 6: Commit**

```bash
git add contracts/card
git commit -m "feat(card): bounded merchant allowlist with owner-gated add/remove

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Policy engine (`enforce_payment`)

**Files:**
- Create: `contracts/card/src/policy.rs`
- Modify: `contracts/card/src/lib.rs` (add `mod policy;`, `remaining()` getter)
- Create: `contracts/card/src/test/policy.rs`
- Modify: `contracts/card/src/test/mod.rs` (add `mod policy;`)

**Interfaces:**
- Consumes: `allowlist::is_allowed`, `DataKey::*`, `CardError::*`, `extend_instance`.
- Produces:
  - `pub(crate) fn policy::current_period(now: u64, policy: &Policy, stored: &Period) -> Period` (pure)
  - `pub(crate) fn policy::enforce_payment(env: &Env, to: &Address, amount: i128) -> Result<(), CardError>` — checks state, expiry, allowlist, per-tx cap, budget; on success persists `Period{spent += amount}` and extends TTL.
  - Entrypoint `remaining() -> i128` — budget left in the current (virtual) period.

- [ ] **Step 1: Write the failing tests**

`contracts/card/src/test/policy.rs`:
```rust
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::Address;

use super::{default_policy, setup, Fixture, DAY, T0, USDC};
use crate::policy::{current_period, enforce_payment};
use crate::{CardError, Period, State};

fn allowed_merchant(f: &Fixture) -> Address {
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    m
}

fn pay(f: &Fixture, to: &Address, amount: i128) -> Result<(), CardError> {
    f.env.as_contract(&f.card, || enforce_payment(&f.env, to, amount))
}

// ---- current_period (pure) ----

#[test]
fn period_unchanged_before_boundary() {
    let p = default_policy();
    let stored = Period { start: T0, spent: 7 };
    assert_eq!(current_period(T0 + DAY - 1, &p, &stored), stored);
}

#[test]
fn period_resets_at_boundary() {
    let p = default_policy();
    let stored = Period { start: T0, spent: 7 };
    assert_eq!(current_period(T0 + DAY, &p, &stored), Period { start: T0 + DAY, spent: 0 });
}

#[test]
fn period_skips_multiple_boundaries_once() {
    let p = default_policy();
    let stored = Period { start: T0, spent: 7 };
    // 2.5 periods later → start aligns to the 2nd boundary, spent resets.
    assert_eq!(
        current_period(T0 + 2 * DAY + DAY / 2, &p, &stored),
        Period { start: T0 + 2 * DAY, spent: 0 }
    );
}

// ---- enforce_payment ----

#[test]
fn accepts_within_budget_and_accounts_spend() {
    let f = setup();
    let m = allowed_merchant(&f);
    assert_eq!(pay(&f, &m, 4 * USDC), Ok(()));
    assert_eq!(f.client.period(), Period { start: T0, spent: 4 * USDC });
    assert_eq!(f.client.remaining(), 46 * USDC);
}

#[test]
fn rejects_over_budget_across_multiple_payments() {
    let f = setup();
    let m = allowed_merchant(&f);
    for _ in 0..5 {
        assert_eq!(pay(&f, &m, 10 * USDC), Ok(()));
    }
    assert_eq!(f.client.remaining(), 0);
    assert_eq!(pay(&f, &m, 1), Err(CardError::OverBudget));
    // Failed attempt must not change accounting.
    assert_eq!(f.client.period().spent, 50 * USDC);
}

#[test]
fn rejects_over_per_tx_cap() {
    let f = setup();
    let m = allowed_merchant(&f);
    assert_eq!(pay(&f, &m, 10 * USDC + 1), Err(CardError::OverPerTxCap));
}

#[test]
fn rejects_unlisted_merchant() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    assert_eq!(pay(&f, &stranger, 1 * USDC), Err(CardError::NotAllowlisted));
}

#[test]
fn rejects_nonpositive_amount() {
    let f = setup();
    let m = allowed_merchant(&f);
    assert_eq!(pay(&f, &m, 0), Err(CardError::InvalidAmount));
    assert_eq!(pay(&f, &m, -1), Err(CardError::InvalidAmount));
}

#[test]
fn rejects_after_expiry() {
    let f = setup();
    let m = allowed_merchant(&f);
    f.env.ledger().set_timestamp(default_policy().expiry);
    assert_eq!(pay(&f, &m, 1 * USDC), Err(CardError::Expired));
}

#[test]
fn budget_resets_in_next_period() {
    let f = setup();
    let m = allowed_merchant(&f);
    for _ in 0..5 {
        assert_eq!(pay(&f, &m, 10 * USDC), Ok(()));
    }
    f.env.ledger().set_timestamp(T0 + DAY);
    assert_eq!(f.client.remaining(), 50 * USDC);
    assert_eq!(pay(&f, &m, 10 * USDC), Ok(()));
    assert_eq!(f.client.period(), Period { start: T0 + DAY, spent: 10 * USDC });
}

#[test]
fn rejects_when_frozen_or_cancelled() {
    let f = setup();
    let m = allowed_merchant(&f);
    f.env.as_contract(&f.card, || {
        f.env.storage().instance().set(&crate::DataKey::State, &State::Frozen);
    });
    assert_eq!(pay(&f, &m, 1 * USDC), Err(CardError::Frozen));
    f.env.as_contract(&f.card, || {
        f.env.storage().instance().set(&crate::DataKey::State, &State::Cancelled);
    });
    assert_eq!(pay(&f, &m, 1 * USDC), Err(CardError::Cancelled));
}
```

Add `mod policy;` to `test/mod.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p mooring-card policy`
Expected: compile error — `crate::policy` not found.

- [ ] **Step 3: Implement `policy.rs`**

```rust
use soroban_sdk::{Address, Env};

use crate::allowlist;
use crate::types::{CardError, DataKey, Period, Policy, State};

/// Returns the period that applies at `now`. If one or more period boundaries
/// have passed since `stored.start`, the start aligns to the most recent boundary
/// and `spent` resets to zero (no carry-over).
pub(crate) fn current_period(now: u64, policy: &Policy, stored: &Period) -> Period {
    let end = stored.start.saturating_add(policy.period_duration);
    if now < end {
        return stored.clone();
    }
    let elapsed = now - stored.start;
    let periods = elapsed / policy.period_duration;
    Period { start: stored.start + periods * policy.period_duration, spent: 0 }
}

/// Validates a payment of `amount` to `to` against state, expiry, allowlist,
/// per-tx cap and period budget. On success persists the updated period.
pub(crate) fn enforce_payment(env: &Env, to: &Address, amount: i128) -> Result<(), CardError> {
    if amount <= 0 {
        return Err(CardError::InvalidAmount);
    }
    let s = env.storage().instance();
    match s.get::<_, State>(&DataKey::State).unwrap() {
        State::Active => {}
        State::Frozen => return Err(CardError::Frozen),
        State::Cancelled => return Err(CardError::Cancelled),
    }
    let now = env.ledger().timestamp();
    let policy: Policy = s.get(&DataKey::Policy).unwrap();
    if now >= policy.expiry {
        return Err(CardError::Expired);
    }
    if !allowlist::is_allowed(env, to) {
        return Err(CardError::NotAllowlisted);
    }
    if amount > policy.max_per_tx {
        return Err(CardError::OverPerTxCap);
    }
    let stored: Period = s.get(&DataKey::Period).unwrap();
    let mut period = current_period(now, &policy, &stored);
    let new_spent = period.spent.checked_add(amount).ok_or(CardError::OverBudget)?;
    if new_spent > policy.period_amount {
        return Err(CardError::OverBudget);
    }
    period.spent = new_spent;
    s.set(&DataKey::Period, &period);
    crate::extend_instance(env);
    Ok(())
}

/// Budget left in the period that applies right now (read-only).
pub(crate) fn remaining(env: &Env) -> i128 {
    let s = env.storage().instance();
    let policy: Policy = s.get(&DataKey::Policy).unwrap();
    let stored: Period = s.get(&DataKey::Period).unwrap();
    let period = current_period(env.ledger().timestamp(), &policy, &stored);
    policy.period_amount - period.spent
}
```

- [ ] **Step 4: Wire `remaining()` in `lib.rs`**

Add `mod policy;` after `mod allowlist;`. Inside `impl Card` after `allow_count`:
```rust
    /// Budget remaining in the current period, accounting for a pending reset.
    pub fn remaining(env: Env) -> i128 {
        policy::remaining(&env)
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p mooring-card`
Expected: all PASS (25 tests).

- [ ] **Step 6: Commit**

```bash
git add contracts/card
git commit -m "feat(card): policy engine with period reset, per-tx cap, budget accounting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `__check_auth` (signature + strict context allow-list)

**Files:**
- Create: `contracts/card/src/auth.rs`
- Modify: `contracts/card/src/lib.rs` (add `mod auth;`)
- Create: `contracts/card/src/test/auth.rs`
- Modify: `contracts/card/src/test/mod.rs` (add `mod auth;`)

**Interfaces:**
- Consumes: `Sig`, `DataKey::{Signer, Token}`, `CardError::{BadSignature, WrongContext}`, `policy::enforce_payment`.
- Produces: `impl CustomAccountInterface for Card { type Signature = Vec<Sig>; type Error = CardError; fn __check_auth(...) }`. Emits **no events**.

- [ ] **Step 1: Write the failing tests**

`contracts/card/src/test/auth.rs`:
```rust
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{symbol_short, vec, Address, BytesN, Env, IntoVal, Symbol, Val, Vec};

use super::{setup, Fixture, USDC};
use crate::{Card, CardError, Sig};

struct Agent {
    key: SigningKey,
}

impl Agent {
    fn new() -> Self {
        Agent { key: SigningKey::generate(&mut rand::thread_rng()) }
    }
    fn public_key(&self, env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &self.key.verifying_key().to_bytes())
    }
    fn sign(&self, env: &Env, payload: &BytesN<32>) -> Val {
        let sig = self.key.sign(&payload.to_array());
        let s = Sig {
            public_key: self.public_key(env),
            signature: BytesN::from_array(env, &sig.to_bytes()),
        };
        vec![env, s].into_val(env)
    }
}

/// Card fixture whose signer is a real ed25519 key we can sign with.
fn setup_with_agent<'a>() -> (Fixture<'a>, Agent) {
    let env = Env::default();
    soroban_sdk::testutils::Ledger::set_timestamp(&env.ledger(), super::T0);
    let agent = Agent::new();
    let owner = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let agent_pk = agent.public_key(&env);
    let card = env.register(
        Card,
        (owner.clone(), agent_pk.clone(), token.clone(), super::default_policy()),
    );
    let client = crate::CardClient::new(&env, &card);
    (Fixture { env, card, client, owner, agent_pk, token, token_admin }, agent)
}

fn payload(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

fn transfer_ctx(f: &Fixture, contract: &Address, fn_name: Symbol, from: &Address, to: &Address, amount: i128) -> Vec<Context> {
    vec![
        &f.env,
        Context::Contract(ContractContext {
            contract: contract.clone(),
            fn_name,
            args: vec![&f.env, from.into_val(&f.env), to.into_val(&f.env), amount.into_val(&f.env)],
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
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, 3 * USDC);
    assert_eq!(check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx), Ok(()));
    assert_eq!(f.client.period().spent, 3 * USDC);
}

#[test]
fn rejects_signature_from_wrong_key() {
    let (f, _agent) = setup_with_agent();
    let m = allowed(&f);
    let impostor = Agent::new();
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, 1 * USDC);
    assert_eq!(
        check(&f, impostor.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::BadSignature)
    );
}

#[test]
fn rejects_empty_or_multiple_signatures() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, 1 * USDC);
    let none: Vec<Sig> = vec![&f.env];
    assert_eq!(check(&f, none.into_val(&f.env), &ctx), Err(CardError::BadSignature));

    let one: Vec<Sig> = agent.sign(&f.env, &payload(&f.env)).into_val(&f.env);
    let mut two = one.clone();
    two.push_back(one.get(0).unwrap());
    assert_eq!(check(&f, two.into_val(&f.env), &ctx), Err(CardError::BadSignature));
}

#[test]
#[should_panic]
fn tampered_signature_bytes_trap() {
    // ed25519_verify traps on an invalid signature; the host turns that into auth failure.
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, 1 * USDC);
    let other_payload = BytesN::from_array(&f.env, &[9u8; 32]);
    let _ = check(&f, agent.sign(&f.env, &other_payload), &ctx);
}

#[test]
fn rejects_approve_context() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("approve"), &f.card, &m, 1 * USDC);
    assert_eq!(check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx), Err(CardError::WrongContext));
}

#[test]
fn rejects_other_token_contract() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let other = Address::generate(&f.env);
    let ctx = transfer_ctx(&f, &other, symbol_short!("transfer"), &f.card, &m, 1 * USDC);
    assert_eq!(check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx), Err(CardError::WrongContext));
}

#[test]
fn rejects_transfer_from_someone_else() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let someone = Address::generate(&f.env);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &someone, &m, 1 * USDC);
    assert_eq!(check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx), Err(CardError::WrongContext));
}

#[test]
fn rejects_multiple_contexts() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let mut ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, 1 * USDC);
    ctx.push_back(ctx.get(0).unwrap());
    assert_eq!(check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx), Err(CardError::WrongContext));
}

#[test]
fn rejects_empty_contexts() {
    let (f, agent) = setup_with_agent();
    let ctx: Vec<Context> = vec![&f.env];
    assert_eq!(check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx), Err(CardError::WrongContext));
}

#[test]
fn policy_errors_propagate() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, 11 * USDC);
    assert_eq!(check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx), Err(CardError::OverPerTxCap));
}

#[test]
fn check_auth_emits_no_events() {
    let (f, agent) = setup_with_agent();
    let m = allowed(&f);
    let before = f.env.events().all().len();
    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, 1 * USDC);
    assert_eq!(check(&f, agent.sign(&f.env, &payload(&f.env)), &ctx), Ok(()));
    assert_eq!(f.env.events().all().len(), before);
}
```

Add `mod auth;` to `test/mod.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p mooring-card auth`
Expected: compile OK but every test fails with `try_invoke_contract_check_auth` reporting the contract has no `__check_auth` (or a host error). Either way: FAIL.

- [ ] **Step 3: Implement `auth.rs`**

```rust
use soroban_sdk::auth::{Context, CustomAccountInterface};
use soroban_sdk::crypto::Hash;
use soroban_sdk::{contractimpl, symbol_short, Address, BytesN, Env, TryFromVal, Vec};

use crate::policy;
use crate::types::{CardError, DataKey, Sig};
use crate::Card;

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
        env.crypto()
            .ed25519_verify(&sig.public_key, &signature_payload.clone().into(), &sig.signature);

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
```

Add `mod auth;` to `lib.rs` after `mod policy;`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p mooring-card`
Expected: all PASS (36 tests). If `accepts_valid_transfer_and_accounts_spend` fails only on the `period().spent` assertion, storage written inside `try_invoke_contract_check_auth` is not being committed by the test host; in that case read the value inside the same invocation by moving the assertion into a follow-up `check` that expects `OverBudget` after 50 USDC of accepted payments (same evidence, different observation).

- [ ] **Step 5: Commit**

```bash
git add contracts/card
git commit -m "feat(card): __check_auth with agent signature and strict transfer-only context

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Owner operations, `bump`, events

**Files:**
- Modify: `contracts/card/src/lib.rs` (add `freeze`, `unfreeze`, `cancel`, `withdraw`, `bump`, events)
- Create: `contracts/card/src/test/owner.rs`
- Modify: `contracts/card/src/test/mod.rs` (add `mod owner;`)

**Interfaces:**
- Consumes: `require_owner`, `State`, `CardError::{InvalidState, InvalidAmount}`, `token::Client`.
- Produces entrypoints:
  - `freeze() -> Result<(), CardError>` (Active → Frozen)
  - `unfreeze() -> Result<(), CardError>` (Frozen → Active)
  - `cancel() -> Result<(), CardError>` (Active|Frozen → Cancelled, sweeps full balance to owner)
  - `withdraw(amount: i128) -> Result<(), CardError>` (owner; any state)
  - `bump()` (anyone; extends instance TTL)
  - Events (owner path only): `StateChanged { state: State }`, `Withdrawn { to: Address, amount: i128 }`, `MerchantAdded { merchant: Address }`, `MerchantRemoved { merchant: Address }`

- [ ] **Step 1: Write the failing tests**

`contracts/card/src/test/owner.rs`:
```rust
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address};

use super::{fund_card, setup, USDC};
use crate::{CardError, State};

fn owner_balance(f: &super::Fixture) -> i128 {
    token::Client::new(&f.env, &f.token).balance(&f.owner)
}

#[test]
fn freeze_and_unfreeze_transition_state() {
    let f = setup();
    f.env.mock_all_auths();
    f.client.freeze();
    assert_eq!(f.client.state(), State::Frozen);
    f.client.unfreeze();
    assert_eq!(f.client.state(), State::Active);
}

#[test]
fn freeze_twice_is_invalid_state() {
    let f = setup();
    f.env.mock_all_auths();
    f.client.freeze();
    assert_eq!(f.client.try_freeze().unwrap_err().unwrap(), CardError::InvalidState);
}

#[test]
fn unfreeze_when_active_is_invalid_state() {
    let f = setup();
    f.env.mock_all_auths();
    assert_eq!(f.client.try_unfreeze().unwrap_err().unwrap(), CardError::InvalidState);
}

#[test]
fn cancel_sweeps_balance_to_owner_and_is_terminal() {
    let f = setup();
    fund_card(&f, 30 * USDC);
    f.env.mock_all_auths();
    f.client.cancel();
    assert_eq!(f.client.state(), State::Cancelled);
    assert_eq!(f.client.balance(), 0);
    assert_eq!(owner_balance(&f), 30 * USDC);
    assert_eq!(f.client.try_unfreeze().unwrap_err().unwrap(), CardError::InvalidState);
    assert_eq!(f.client.try_freeze().unwrap_err().unwrap(), CardError::InvalidState);
    assert_eq!(f.client.try_cancel().unwrap_err().unwrap(), CardError::InvalidState);
}

#[test]
fn cancel_with_zero_balance_succeeds() {
    let f = setup();
    f.env.mock_all_auths();
    f.client.cancel();
    assert_eq!(f.client.state(), State::Cancelled);
}

#[test]
fn withdraw_moves_tokens_to_owner_in_any_state() {
    let f = setup();
    fund_card(&f, 30 * USDC);
    f.env.mock_all_auths();
    f.client.withdraw(&10 * USDC);
    assert_eq!(f.client.balance(), 20 * USDC);
    assert_eq!(owner_balance(&f), 10 * USDC);
    f.client.freeze();
    f.client.withdraw(&5 * USDC);
    assert_eq!(f.client.balance(), 15 * USDC);
}

#[test]
fn withdraw_rejects_nonpositive_amount() {
    let f = setup();
    f.env.mock_all_auths();
    assert_eq!(f.client.try_withdraw(&0).unwrap_err().unwrap(), CardError::InvalidAmount);
}

#[test]
#[should_panic(expected = "Auth")]
fn withdraw_requires_owner_auth() {
    let f = setup();
    fund_card(&f, 30 * USDC);
    // fund_card enabled mock_all_auths; start a fresh env without it.
    let g = setup();
    g.client.withdraw(&1);
}

#[test]
fn bump_is_callable_by_anyone() {
    let f = setup();
    f.client.bump(); // no auth, must not panic
}

#[test]
fn owner_ops_emit_events() {
    let f = setup();
    f.env.mock_all_auths();
    let before = f.env.events().all().len();
    f.client.freeze();
    f.client.add_merchant(&Address::generate(&f.env));
    let after = f.env.events().all().len();
    assert_eq!(after - before, 2);
}
```

Add `mod owner;` to `test/mod.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p mooring-card owner`
Expected: compile error — `freeze`, `withdraw`, `bump` not found.

- [ ] **Step 3: Implement owner ops and events in `lib.rs`**

Add to imports: `use soroban_sdk::contractevent;`. Add after the constants:

```rust
#[contractevent(topics = ["state_changed"])]
pub struct StateChanged {
    pub state: State,
}

#[contractevent(topics = ["withdrawn"])]
pub struct Withdrawn {
    pub to: Address,
    pub amount: i128,
}

#[contractevent(topics = ["merchant_added"])]
pub struct MerchantAdded {
    pub merchant: Address,
}

#[contractevent(topics = ["merchant_removed"])]
pub struct MerchantRemoved {
    pub merchant: Address,
}

fn set_state(env: &Env, state: State) {
    env.storage().instance().set(&DataKey::State, &state);
    StateChanged { state }.publish(env);
}

fn transfer_to_owner(env: &Env, amount: i128) {
    let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
    let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
    // The card is the direct invoker, so this transfer is invoker-authorized and
    // does not pass through __check_auth. Owner ops are not subject to the policy.
    token::Client::new(env, &token).transfer(&env.current_contract_address(), &owner, &amount);
    Withdrawn { to: owner, amount }.publish(env);
}
```

Update `add_merchant` / `remove_merchant` to publish `MerchantAdded { merchant }` / `MerchantRemoved { merchant }` after the allowlist call. Then add inside `impl Card`:

```rust
    /// Owner: pause agent payments. Active → Frozen.
    pub fn freeze(env: Env) -> Result<(), CardError> {
        require_owner(&env);
        if Self::state(env.clone()) != State::Active {
            return Err(CardError::InvalidState);
        }
        set_state(&env, State::Frozen);
        extend_instance(&env);
        Ok(())
    }

    /// Owner: resume agent payments. Frozen → Active.
    pub fn unfreeze(env: Env) -> Result<(), CardError> {
        require_owner(&env);
        if Self::state(env.clone()) != State::Frozen {
            return Err(CardError::InvalidState);
        }
        set_state(&env, State::Active);
        extend_instance(&env);
        Ok(())
    }

    /// Owner: permanently disable the card and sweep its full balance to the owner.
    pub fn cancel(env: Env) -> Result<(), CardError> {
        require_owner(&env);
        if Self::state(env.clone()) == State::Cancelled {
            return Err(CardError::InvalidState);
        }
        set_state(&env, State::Cancelled);
        let bal = Self::balance(env.clone());
        if bal > 0 {
            transfer_to_owner(&env, bal);
        }
        extend_instance(&env);
        Ok(())
    }

    /// Owner: move `amount` of the token to the owner. Allowed in any state.
    pub fn withdraw(env: Env, amount: i128) -> Result<(), CardError> {
        require_owner(&env);
        if amount <= 0 {
            return Err(CardError::InvalidAmount);
        }
        transfer_to_owner(&env, amount);
        extend_instance(&env);
        Ok(())
    }

    /// Anyone: extend the card's instance TTL so it does not get archived.
    pub fn bump(env: Env) {
        extend_instance(&env);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p mooring-card`
Expected: all PASS (46 tests). If `owner_ops_emit_events` reports 3 instead of 2, the SAC transfer inside `freeze` is not involved (it isn't); check that `set_state` publishes exactly once.

- [ ] **Step 5: Lint and commit**

Run: `make lint` — fix any clippy warnings (typical: `needless_return`).

```bash
git add contracts/card
git commit -m "feat(card): owner freeze/unfreeze/cancel/withdraw, bump, events

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Owner policy update and signer rotation

**Files:**
- Modify: `contracts/card/src/policy.rs` (add `validate`, clamp `remaining`)
- Modify: `contracts/card/src/lib.rs` (constructor uses `policy::validate`; add `set_policy`, `set_signer`, events)
- Create: `contracts/card/src/test/update.rs`
- Modify: `contracts/card/src/test/mod.rs` (add `mod update;`)
- Modify: `contracts/card/src/test/auth.rs` (one rotation test; make `Agent`, `setup_with_agent`, `payload`, `transfer_ctx`, `check`, `allowed` `pub(super)`)

**Interfaces:**
- Consumes: `Policy`, `DataKey::{Policy, Signer}`, `CardError::InvalidPolicy`, `require_owner`, `extend_instance`.
- Produces:
  - `pub(crate) fn policy::validate(now: u64, policy: &Policy) -> Result<(), CardError>`
  - Entrypoints `set_policy(policy: Policy) -> Result<(), CardError>`, `set_signer(signer: BytesN<32>)`
  - Events `PolicyChanged { policy: Policy }`, `SignerChanged { signer: BytesN<32> }`
  - `remaining()` never returns a negative number.

- [ ] **Step 1: Write the failing tests**

`contracts/card/src/test/update.rs`:
```rust
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN};

use super::{default_policy, setup, DAY, T0, USDC};
use crate::policy::enforce_payment;
use crate::{CardError, Policy};

#[test]
fn owner_can_update_policy() {
    let f = setup();
    f.env.mock_all_auths();
    let new = Policy {
        period_amount: 100 * USDC,
        period_duration: 7 * DAY,
        max_per_tx: 20 * USDC,
        expiry: T0 + 60 * DAY,
    };
    f.client.set_policy(&new);
    assert_eq!(f.client.policy(), new);
    assert_eq!(f.client.remaining(), 100 * USDC);
}

#[test]
fn policy_update_keeps_current_period_spend() {
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    f.env.as_contract(&f.card, || enforce_payment(&f.env, &m, 10 * USDC)).unwrap();

    f.client.set_policy(&Policy { period_amount: 15 * USDC, ..default_policy() });
    assert_eq!(f.client.remaining(), 5 * USDC);
}

#[test]
fn remaining_clamps_to_zero_when_budget_lowered_below_spend() {
    let f = setup();
    f.env.mock_all_auths();
    let m = Address::generate(&f.env);
    f.client.add_merchant(&m);
    f.env.as_contract(&f.card, || enforce_payment(&f.env, &m, 10 * USDC)).unwrap();

    f.client.set_policy(&Policy { period_amount: 5 * USDC, max_per_tx: 5 * USDC, ..default_policy() });
    assert_eq!(f.client.remaining(), 0);
    let r = f.env.as_contract(&f.card, || enforce_payment(&f.env, &m, 1));
    assert_eq!(r, Err(CardError::OverBudget));
}

#[test]
fn set_policy_validates_like_constructor() {
    let f = setup();
    f.env.mock_all_auths();
    let bad = [
        Policy { period_amount: 0, ..default_policy() },
        Policy { period_duration: 0, ..default_policy() },
        Policy { max_per_tx: 0, ..default_policy() },
        Policy { max_per_tx: 60 * USDC, ..default_policy() },
        Policy { expiry: T0, ..default_policy() },
    ];
    for p in bad {
        assert_eq!(f.client.try_set_policy(&p).unwrap_err().unwrap(), CardError::InvalidPolicy);
    }
    assert_eq!(f.client.policy(), default_policy());
}

#[test]
#[should_panic(expected = "Auth")]
fn set_policy_requires_owner_auth() {
    let f = setup();
    f.client.set_policy(&default_policy());
}

#[test]
fn owner_can_rotate_signer() {
    let f = setup();
    f.env.mock_all_auths();
    let new = BytesN::from_array(&f.env, &[9u8; 32]);
    f.client.set_signer(&new);
    assert_eq!(f.client.signer(), new);
}

#[test]
#[should_panic(expected = "Auth")]
fn set_signer_requires_owner_auth() {
    let f = setup();
    f.client.set_signer(&BytesN::from_array(&f.env, &[9u8; 32]));
}

#[test]
fn update_ops_emit_events() {
    let f = setup();
    f.env.mock_all_auths();
    let before = f.env.events().all().len();
    f.client.set_policy(&default_policy());
    f.client.set_signer(&BytesN::from_array(&f.env, &[9u8; 32]));
    assert_eq!(f.env.events().all().len() - before, 2);
}
```

Append to `contracts/card/src/test/auth.rs` (after making the helpers `pub(super)`):
```rust
#[test]
fn rotated_signer_replaces_old_agent() {
    let (f, old_agent) = setup_with_agent();
    let m = allowed(&f);
    let new_agent = Agent::new();
    f.client.set_signer(&new_agent.public_key(&f.env));

    let ctx = transfer_ctx(&f, &f.token, symbol_short!("transfer"), &f.card, &m, 1 * USDC);
    assert_eq!(
        check(&f, old_agent.sign(&f.env, &payload(&f.env)), &ctx),
        Err(CardError::BadSignature)
    );
    assert_eq!(check(&f, new_agent.sign(&f.env, &payload(&f.env)), &ctx), Ok(()));
}
```

Add `mod update;` to `test/mod.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p mooring-card update`
Expected: compile error — `set_policy`, `set_signer` not found.

- [ ] **Step 3: Add `validate` to `policy.rs` and clamp `remaining`**

Add at the top of `policy.rs` (after imports):
```rust
/// Shared validation for the constructor and `set_policy`.
pub(crate) fn validate(now: u64, policy: &Policy) -> Result<(), CardError> {
    if policy.period_amount <= 0
        || policy.period_duration == 0
        || policy.max_per_tx <= 0
        || policy.max_per_tx > policy.period_amount
        || policy.expiry <= now
    {
        return Err(CardError::InvalidPolicy);
    }
    Ok(())
}
```

Change the last line of `remaining` from `policy.period_amount - period.spent` to:
```rust
    (policy.period_amount - period.spent).max(0)
```

- [ ] **Step 4: Refactor the constructor and add the entrypoints in `lib.rs`**

Replace the constructor's inline `if policy.period_amount <= 0 || ... { panic_with_error!(...) }` block with:
```rust
        if policy::validate(now, &policy).is_err() {
            panic_with_error!(&env, CardError::InvalidPolicy);
        }
```

Add events next to the existing ones:
```rust
#[contractevent(topics = ["policy_changed"])]
pub struct PolicyChanged {
    pub policy: Policy,
}

#[contractevent(topics = ["signer_changed"])]
pub struct SignerChanged {
    pub signer: BytesN<32>,
}
```

Add inside `impl Card`:
```rust
    /// Owner: replace the spending policy. Current-period spend is kept; if the new
    /// budget is below it, `remaining()` is 0 until the period resets.
    pub fn set_policy(env: Env, policy: Policy) -> Result<(), CardError> {
        require_owner(&env);
        policy::validate(env.ledger().timestamp(), &policy)?;
        env.storage().instance().set(&DataKey::Policy, &policy);
        PolicyChanged { policy }.publish(&env);
        extend_instance(&env);
        Ok(())
    }

    /// Owner: rotate the agent key. Signatures by the previous key stop validating immediately.
    pub fn set_signer(env: Env, signer: BytesN<32>) {
        require_owner(&env);
        env.storage().instance().set(&DataKey::Signer, &signer);
        SignerChanged { signer }.publish(&env);
        extend_instance(&env);
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p mooring-card`
Expected: all PASS (55 tests).

- [ ] **Step 6: Lint and commit**

Run: `make lint`.

```bash
git add contracts/card
git commit -m "feat(card): owner-mutable policy and agent signer rotation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Factory contract

**Files:**
- Create: `contracts/factory/Cargo.toml`, `contracts/factory/src/lib.rs`, `contracts/factory/src/test.rs`
- Modify: `Cargo.toml` (members), `Makefile` (remove `|| true`)

**Interfaces:**
- Consumes: card WASM at `target/wasm32v1-none/release/mooring_card.wasm` via `contractimport!` (provides `card::Client`, `card::Policy`, `card::WASM`).
- Produces:
  - `Factory::__constructor(env, card_wasm_hash: BytesN<32>)`
  - `create_card(owner: Address, signer: BytesN<32>, token: Address, policy: card::Policy, salt: BytesN<32>) -> Address` (requires `owner` auth; deterministic address from `(factory, salt)`)
  - `card_wasm_hash() -> BytesN<32>`
  - Event `CardCreated { owner: Address, card: Address }` with topic `card_created`

- [ ] **Step 1: Crate manifest and workspace wiring**

`contracts/factory/Cargo.toml`:
```toml
[package]
name = "mooring-factory"
version.workspace = true
edition.workspace = true
license.workspace = true
publish = false

[lib]
crate-type = ["cdylib", "lib"]
doctest = false

[dependencies]
soroban-sdk = { workspace = true }

[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
```

In root `Cargo.toml` set `members = ["contracts/card", "contracts/factory"]`. In `Makefile` remove ` || true` from the factory build line.

- [ ] **Step 2: Write the failing test**

`contracts/factory/src/test.rs`:
```rust
#![cfg(test)]

use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, BytesN, Env};

use crate::{card, Factory, FactoryClient};

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

    let c = card::Client::new(&env, &card_addr);
    assert_eq!(c.owner(), owner);
    assert_eq!(c.signer(), signer);
    assert_eq!(c.token(), token);
    assert_eq!(c.policy(), policy());

    let (emitter, _topics, _data) = env.events().all().last().unwrap();
    assert_eq!(emitter, factory_id);
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `make build && cargo test -p mooring-factory`
Expected: compile error — `Factory` not found.

- [ ] **Step 4: Implement `lib.rs`**

```rust
#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, BytesN, Env};

#[cfg(test)]
mod test;

/// Card contract bindings (types + client) generated from the built WASM.
/// Build the card first: `cargo build -p mooring-card --target wasm32v1-none --release`.
pub mod card {
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
        env.storage().instance().set(&DataKey::CardWasmHash, &card_wasm_hash);
    }

    pub fn card_wasm_hash(env: Env) -> BytesN<32> {
        env.storage().instance().get(&DataKey::CardWasmHash).unwrap()
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
        let wasm_hash: BytesN<32> = env.storage().instance().get(&DataKey::CardWasmHash).unwrap();
        let card = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, (owner.clone(), signer, token, policy));
        CardCreated { owner, card: card.clone() }.publish(&env);
        env.storage().instance().extend_ttl(17_280, 518_400);
        card
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `make test`
Expected: card tests PASS, factory 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml Makefile contracts/factory
git commit -m "feat(factory): deterministic card deployment with card_created event

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Testnet deployment scripts

**Files:**
- Create: `scripts/testnet/deploy.sh`, `scripts/testnet/fund.sh`, `docs/testnet.md`
- Modify: `.gitignore` (already ignores `deployed.*.json`)

**Interfaces:**
- Consumes: built WASM from Task 1/8; the `stellar` CLI (v23+) with identities `deployer`, `owner`, `agent`, `merchant`, `funder`.
- Produces: `deployed.testnet.json` (gitignored) with `factory`, `card`, `card_wasm_hash`, `token`, `owner`, `agent_pk_hex`, `merchant`; and `docs/testnet.md` (committed) listing public addresses only.

- [ ] **Step 1: `deploy.sh`**

```bash
#!/usr/bin/env bash
# Deploys the factory and creates one card on Stellar testnet.
# Requires: stellar CLI, node (for the agent key hex conversion), jq.
set -euo pipefail
cd "$(dirname "$0")/../.."

NETWORK=testnet
USDC_SAC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
OUT=deployed.testnet.json

for id in deployer owner agent merchant funder; do
  if ! stellar keys address "$id" >/dev/null 2>&1; then
    stellar keys generate --global "$id" --network $NETWORK --fund
  fi
done

# Merchant and funder must hold a USDC trustline (SAC settles into classic balances).
for id in merchant funder; do
  stellar tx new change-trust --source "$id" --network $NETWORK \
    --line "USDC:$USDC_ISSUER" >/dev/null || true
done

make build

CARD_WASM_HASH=$(stellar contract upload --source deployer --network $NETWORK \
  --wasm target/wasm32v1-none/release/mooring_card.wasm)
FACTORY=$(stellar contract deploy --source deployer --network $NETWORK \
  --wasm target/wasm32v1-none/release/mooring_factory.wasm \
  -- --card_wasm_hash "$CARD_WASM_HASH")

AGENT_G=$(stellar keys address agent)
# BytesN<32> args are passed to the CLI as hex; decode the agent's G address.
AGENT_PK_HEX=$(cd scripts/agent && node -e \
  "const {StrKey}=require('@stellar/stellar-sdk');console.log(StrKey.decodeEd25519PublicKey(process.argv[1]).toString('hex'))" "$AGENT_G")

EXPIRY=$(( $(date +%s) + 30*86400 ))
SALT=$(openssl rand -hex 32)
POLICY="{\"period_amount\":\"500000000\",\"period_duration\":86400,\"max_per_tx\":\"100000000\",\"expiry\":$EXPIRY}"

CARD=$(stellar contract invoke --source owner --network $NETWORK --id "$FACTORY" -- \
  create_card --owner owner --signer "$AGENT_PK_HEX" --token "$USDC_SAC" \
  --policy "$POLICY" --salt "$SALT" | tr -d '"')

MERCHANT=$(stellar keys address merchant)
stellar contract invoke --source owner --network $NETWORK --id "$CARD" -- \
  add_merchant --merchant "$MERCHANT" >/dev/null

jq -n --arg factory "$FACTORY" --arg card "$CARD" --arg hash "$CARD_WASM_HASH" \
  --arg token "$USDC_SAC" --arg owner "$(stellar keys address owner)" \
  --arg agent "$AGENT_G" --arg agent_pk_hex "$AGENT_PK_HEX" --arg merchant "$MERCHANT" \
  --arg funder "$(stellar keys address funder)" \
  '{factory:$factory, card:$card, card_wasm_hash:$hash, token:$token, owner:$owner, agent:$agent, agent_pk_hex:$agent_pk_hex, merchant:$merchant, funder:$funder}' > $OUT

echo "Deployed. See $OUT"
echo "Next: get testnet USDC for the funder at https://faucet.circle.com (Stellar testnet):"
echo "  $(stellar keys address funder)"
echo "Then run scripts/testnet/fund.sh"
```

Run `cd scripts/agent && npm install` (Task 10 creates the package; if executing Task 9 first, run `npm init -y && npm i @stellar/stellar-sdk@^17` in `scripts/agent` temporarily) so the node one-liner can resolve `@stellar/stellar-sdk`.

- [ ] **Step 2: `fund.sh`**

```bash
#!/usr/bin/env bash
# Moves USDC from the funder account into the card (SAC transfer to a C address).
set -euo pipefail
cd "$(dirname "$0")/../.."
NETWORK=testnet
CARD=$(jq -r .card deployed.testnet.json)
TOKEN=$(jq -r .token deployed.testnet.json)
AMOUNT=${1:-200000000}   # default 20 USDC

stellar contract invoke --source funder --network $NETWORK --id "$TOKEN" -- \
  transfer --from funder --to "$CARD" --amount "$AMOUNT"

stellar contract invoke --network $NETWORK --id "$CARD" -- balance
```

- [ ] **Step 3: Run deploy and fund**

```bash
chmod +x scripts/testnet/*.sh
scripts/testnet/deploy.sh
# → visit Circle faucet for the funder address, then:
scripts/testnet/fund.sh
```
Expected: `balance` prints `"200000000"`.

- [ ] **Step 4: Record public addresses in `docs/testnet.md`**

```markdown
# Testnet deployment (D1)

Network: Stellar testnet (`Test SDF Network ; September 2015`). Testnet resets quarterly; re-run `scripts/testnet/deploy.sh` after a reset.

| Item | Value |
|---|---|
| Card WASM hash | `<from deployed.testnet.json>` |
| Factory | `C...` |
| Card | `C...` |
| Token (USDC SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Owner | `G...` |
| Agent (signer) | `G...` |
| Merchant | `G...` |

Policy: 50 USDC / day, max 10 USDC per payment, expiry +30 days.

## Evidence

Filled in by Task 10.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/testnet docs/testnet.md
git commit -m "chore(testnet): deploy and fund scripts, deployment record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Card signer + on-chain evidence (accepted payment, rejected payment, fee measurement)

**Files:**
- Create: `scripts/agent/package.json`, `scripts/agent/tsconfig.json`, `scripts/agent/.env.example`
- Create: `scripts/agent/src/common.ts`, `scripts/agent/src/card-signer.ts`, `scripts/agent/src/pay.ts`, `scripts/agent/src/race.ts`
- Modify: `docs/testnet.md` (Evidence section), `docs/spike-w1-auth-mechanism.md` (fee measurement result)

**Interfaces:**
- Consumes: `deployed.testnet.json`, agent secret (`stellar keys show agent`), two funded submitter secrets.
- Produces: `signCardAuthEntries(tx, cardAddress, agentKeypair, expirationLedger)` — reused by the D2 agent client; two tx hashes (SUCCESS and FAILED) and a `minResourceFee` number.

- [ ] **Step 1: Package setup**

`scripts/agent/package.json`:
```json
{
  "name": "mooring-agent-scripts",
  "private": true,
  "type": "module",
  "scripts": {
    "pay": "tsx src/pay.ts",
    "race": "tsx src/race.ts"
  },
  "dependencies": {
    "@stellar/stellar-sdk": "^17.0.1",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

`scripts/agent/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`scripts/agent/.env.example`:
```
AGENT_SECRET=S...            # stellar keys show agent
SUBMITTER_A_SECRET=S...      # any funded testnet account (fee payer); stellar keys generate submitter_a --fund
SUBMITTER_B_SECRET=S...      # a second funded account for race.ts
AMOUNT=60000000              # 6 USDC in base units (default)
```

Run: `cd scripts/agent && npm install && cp .env.example .env` and fill `.env`.

- [ ] **Step 2: `common.ts`**

```ts
import "dotenv/config";
import { readFileSync } from "node:fs";
import { Keypair, Networks, rpc } from "@stellar/stellar-sdk";

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const server = new rpc.Server(RPC_URL);

export type Deployed = {
  factory: string; card: string; token: string; owner: string;
  agent: string; merchant: string; funder: string;
};

export function loadDeployed(): Deployed {
  const path = new URL("../../../deployed.testnet.json", import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as Deployed;
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const agentKeypair = () => Keypair.fromSecret(env("AGENT_SECRET"));

export async function waitForTx(hash: string, attempts = 20): Promise<rpc.Api.GetTransactionResponse> {
  for (let i = 0; i < attempts; i++) {
    const r = await server.getTransaction(hash);
    if (r.status !== "NOT_FOUND") return r;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`tx ${hash} not found after ${attempts}s`);
}
```

- [ ] **Step 3: `card-signer.ts` — the reusable piece**

```ts
import { authorizeEntry, contract, Keypair, xdr } from "@stellar/stellar-sdk";

/**
 * Signs every auth entry addressed to `cardAddress` with the agent key.
 * The stock SEP-43 path cannot do this: it derives the public key from the
 * entry address (a C address), so we call `authorizeEntry` directly and return
 * `{ signature, publicKey }`, which the SDK encodes as Vec[{public_key, signature}].
 */
export async function signCardAuthEntries(
  tx: contract.AssembledTransaction<unknown>,
  cardAddress: string,
  agent: Keypair,
  expirationLedger: number,
  networkPassphrase: string,
): Promise<void> {
  await tx.signAuthEntries({
    address: cardAddress,
    expiration: expirationLedger,
    authorizeEntry: (entry: xdr.SorobanAuthorizationEntry, _signer, validUntil: number, passphrase: string) =>
      authorizeEntry(
        entry,
        async (_preimage, payload: Uint8Array) => ({
          signature: agent.sign(Buffer.from(payload)),
          publicKey: agent.publicKey(),
        }),
        validUntil,
        passphrase,
      ),
  });
}
```

If the TypeScript signature of `authorizeEntry`'s callback in the installed SDK version differs (check `node_modules/@stellar/stellar-sdk/types/base/auth.d.ts`), adapt the parameter types only; the runtime behavior above is what stellar-sdk 17.0.1 implements (`base/auth.js`, `authorizeEntry`, branch `"signature" in sigResult`).

- [ ] **Step 4: `pay.ts` — one accepted payment + fee measurement**

```ts
import { Address, contract, Keypair, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { agentKeypair, env, loadDeployed, NETWORK_PASSPHRASE, RPC_URL, server, waitForTx } from "./common.js";
import { signCardAuthEntries } from "./card-signer.js";

const d = loadDeployed();
const agent = agentKeypair();
const submitter = Keypair.fromSecret(env("SUBMITTER_A_SECRET"));
const amount = BigInt(process.env.AMOUNT ?? "60000000");

const tx = await contract.AssembledTransaction.build({
  contractId: d.token,
  method: "transfer",
  args: [
    nativeToScVal(Address.fromString(d.card), { type: "address" }),
    nativeToScVal(Address.fromString(d.merchant), { type: "address" }),
    nativeToScVal(amount, { type: "i128" }),
  ],
  networkPassphrase: NETWORK_PASSPHRASE,
  rpcUrl: RPC_URL,
  publicKey: submitter.publicKey(),
  parseResultXdr: (r) => r,
});

console.log("needs signatures from:", tx.needsNonInvokerSigningBy());
const latest = (await server.getLatestLedger()).sequence;
await signCardAuthEntries(tx, d.card, agent, latest + 60, NETWORK_PASSPHRASE);
await tx.simulate();

const sim = tx.simulation as rpc.Api.SimulateTransactionSuccessResponse;
console.log("minResourceFee (stroops):", sim.minResourceFee);

const sent = await tx.signAndSend({
  signTransaction: contract.basicNodeSigner(submitter, NETWORK_PASSPHRASE).signTransaction,
});
const hash = sent.sendTransactionResponse!.hash;
const final = await waitForTx(hash);
console.log("tx:", hash, "status:", final.status);
```

Run: `npm run pay`
Expected: prints `needs signatures from: [ 'C...card' ]`, a `minResourceFee`, and `status: SUCCESS`. Verify: `stellar contract invoke --network testnet --id $CARD -- period` shows `spent: 60000000`.

If simulation fails with a contract error `#6` the merchant is not allowlisted (re-run `add_merchant`); `#8`/`#7` are budget/cap denials; `#1` means the agent key in `.env` differs from the card's signer.

- [ ] **Step 5: `race.ts` — on-chain rejection evidence**

Two payments are simulated against the same state (both pass), then submitted in order. The second executes against updated state and fails with `OverBudget` on-chain. Prerequisite: `remaining()` must be `< 2 × AMOUNT` and `≥ AMOUNT` (e.g. remaining 10 USDC, AMOUNT 6 USDC after Step 4 left 44 USDC — run `npm run pay` with `AMOUNT=100000000` four more times until remaining is 4 USDC, then use `AMOUNT=30000000`).

```ts
import { Address, contract, Keypair, nativeToScVal } from "@stellar/stellar-sdk";
import { agentKeypair, env, loadDeployed, NETWORK_PASSPHRASE, RPC_URL, server, waitForTx } from "./common.js";
import { signCardAuthEntries } from "./card-signer.js";

const d = loadDeployed();
const agent = agentKeypair();
const amount = BigInt(process.env.AMOUNT ?? "30000000");

async function buildSigned(submitter: Keypair) {
  const tx = await contract.AssembledTransaction.build({
    contractId: d.token,
    method: "transfer",
    args: [
      nativeToScVal(Address.fromString(d.card), { type: "address" }),
      nativeToScVal(Address.fromString(d.merchant), { type: "address" }),
      nativeToScVal(amount, { type: "i128" }),
    ],
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: submitter.publicKey(),
    parseResultXdr: (r) => r,
  });
  const latest = (await server.getLatestLedger()).sequence;
  await signCardAuthEntries(tx, d.card, agent, latest + 60, NETWORK_PASSPHRASE);
  await tx.simulate();
  return tx;
}

async function submit(tx: contract.AssembledTransaction<unknown>, submitter: Keypair) {
  const built = tx.built!;
  built.sign(submitter);
  const res = await server.sendTransaction(built);
  if (res.status !== "PENDING") throw new Error(`send failed: ${JSON.stringify(res)}`);
  return waitForTx(res.hash).then((r) => ({ hash: res.hash, status: r.status }));
}

const a = await buildSigned(Keypair.fromSecret(env("SUBMITTER_A_SECRET")));
const b = await buildSigned(Keypair.fromSecret(env("SUBMITTER_B_SECRET")));

const first = await submit(a, Keypair.fromSecret(env("SUBMITTER_A_SECRET")));
console.log("first :", first.hash, first.status);   // expected SUCCESS
const second = await submit(b, Keypair.fromSecret(env("SUBMITTER_B_SECRET")));
console.log("second:", second.hash, second.status); // expected FAILED (OverBudget on-chain)
```

Run: `npm run race`
Expected: `first: <hash> SUCCESS`, `second: <hash> FAILED`. Inspect the second on https://stellar.expert/explorer/testnet/tx/<hash> — the failure reason shows the card's contract error `#8` (OverBudget).

- [ ] **Step 6: Record evidence and the fee measurement**

In `docs/testnet.md`, replace the Evidence section:
```markdown
## Evidence

| Scenario | Tx hash | Status |
|---|---|---|
| Card-paid transfer within policy (`pay.ts`) | `<hash>` | SUCCESS |
| Race: first of two overlapping payments (`race.ts`) | `<hash>` | SUCCESS |
| Race: second payment, over budget, rejected by `__check_auth` | `<hash>` | FAILED (contract error #8 OverBudget) |

Simulation `minResourceFee` for a card-paid transfer: `<stroops>` stroops
(facilitator library default ceiling: 50 000 stroops).
```

In `docs/spike-w1-auth-mechanism.md`, under "Open measurement", append one line:
`Measured 2026-MM-DD: minResourceFee = <n> stroops → <within | exceeds> the 50 000 default ceiling.`
If it exceeds, open a follow-up in the D2 plan: reduce writes in `enforce_payment` (skip `extend_instance` when TTL is above threshold using `env.storage().instance().get_ttl()`), re-measure, and, if still above, plan to ask OZ Channels for a higher `maxTransactionFeeStroops` or self-host the facilitator (`@x402/stellar/exact/facilitator` is open source).

- [ ] **Step 7: Commit**

```bash
git add scripts/agent/package.json scripts/agent/package-lock.json scripts/agent/tsconfig.json scripts/agent/.env.example scripts/agent/src docs/testnet.md docs/spike-w1-auth-mechanism.md
git commit -m "feat(scripts): card auth-entry signer, testnet payment and rejection evidence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (design.md + spike note → tasks):
- Storage fields incl. `max_per_tx`, allowlist as persistent keys, state → Task 2, 3.
- Owner ops freeze/unfreeze/cancel(sweep)/withdraw/add/remove, `bump` → Task 3, 6.
- Budget reset (no carry-over), per-tx cap, expiry, allowlist, frozen/cancelled → Task 4.
- `__check_auth`: one signature by agent key, one `transfer(self, …)` context, no events → Task 5.
- Owner-mutable policy (`set_policy`, validated, spend kept, clamped remaining) and signer rotation → Task 7.
- Factory with `deploy_v2`, deterministic address, `card_created` → Task 8.
- Testnet deploy + ≥1 on-chain rejection + fee measurement → Task 9, 10.
- TDD, CI, Apache-2.0 → Task 1.
- Not in this plan by design: x402 server/client (D2), web UI (D3).

**Type consistency:** `Policy`/`Period`/`State`/`Sig`/`CardError` defined once in Task 2 and used verbatim in Tasks 3–8; `enforce_payment(&Env, &Address, i128)` matches Tasks 4 and 5; `Fixture` fields used in Tasks 3–6 match Task 2's definition; factory imports `card::Policy` from the WASM so the field set is the same struct.

**Known executor-facing risks (stated in-task):** whether `try_invoke_contract_check_auth` commits storage (Task 5 Step 4 fallback), `#[contractevent]` attribute form on the pinned SDK, exact TS types of `authorizeEntry`'s callback (Task 10 Step 3 note).
