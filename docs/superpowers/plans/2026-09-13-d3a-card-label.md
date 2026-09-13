# D3-A — On-chain Card Label and Factory Redeploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Mooring card an owner-chosen, on-chain `label` (≤ 32 bytes) set at creation and renamable via `set_label`, surface it in `info()`, the client library and the CLI, and redeploy the card WASM + factory on testnet with the label, so the D3 web app can build on it.

**Architecture:** The card contract gains one instance-storage key (`DataKey::Label`), one error (`InvalidLabel = 13`), one owner entrypoint (`set_label`) with an event (`LabelChanged`), and `label` in `CardInfo`. The factory's `create_card` takes the label and passes it to the constructor. Card **code** stays immutable; the change ships as a new WASM hash behind a **new factory** (the D1 versioning model). The TypeScript side only widens `CardInfo`. Testnet gets a fresh factory + card; the old card is cancelled (its balance sweeps to the owner) to fund the new one.

**Tech Stack:** Rust / soroban-sdk 25.3.2 (`soroban_sdk::String`), `stellar` CLI 26.x, TypeScript workspace (`@mooring/x402-client`, `@mooring/cli`), vitest, testnet.

**Spec:** `docs/superpowers/specs/2026-09-13-d3-web-app-design.md` §2 "Card name" row and §3.6.

## Global Constraints

- Repo language English. Testnet only. Secrets never printed or committed.
- `__check_auth` is untouched: no new reads, no events on the payment path. Only the instance entry it already loads grows by the label bytes.
- Label rules: `soroban_sdk::String`, **1..=32 bytes** (`String::len()`), else `CardError::InvalidLabel` (code **13**). Same validation in the constructor (panic) and `set_label` (`Result`).
- `CardInfo` gains `label: String`; the TS `CardInfo.label: string`. `DataKey::Label` is appended at the end of the enum.
- Fee guard: after the change, the 32-merchant simulation must stay under the observed OZ ceiling (≥ 51 175 stroops; D2 measured 49 380 without the label).
- Commit trailer exactly `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Branch `feat/d3-web-app` (already holds the spec); push allowed; PR at the end; never push to `main`; never force-push.

## File Structure

```
contracts/card/src/types.rs            DataKey::Label, CardError::InvalidLabel, CardInfo.label
contracts/card/src/label.rs            validate(&String) -> Result<(), CardError>, MAX_LABEL_LEN
contracts/card/src/lib.rs              constructor arg, label() getter, set_label(), LabelChanged event, info()
contracts/card/src/test/mod.rs         LABEL const; setup() passes it
contracts/card/src/test/auth.rs        setup_with_agent passes the label
contracts/card/src/test/label.rs       new tests
contracts/card/src/test/constructor.rs register_with() passes the label
contracts/factory/src/lib.rs           create_card(label) → constructor
contracts/factory/src/test.rs          label in every create_card call + a label assertion
packages/x402-client/src/card.ts       CardInfo.label, RawCardInfo.label, normalizeInfo
packages/x402-client/test/card.test.ts label assertions
packages/x402-client/test/client.test.ts / precheck.test.ts  fixtures gain `label`
packages/cli/src/index.ts              status prints the label (text mode)
packages/cli/test/cli.test.ts          label in the status fixture
scripts/testnet/deploy.sh              --label on create_card
scripts/testnet/migrate-card.sh        owner trustline, cancel old card, fund new card
scripts/agent/src/fee32.ts             prints the 1-merchant baseline before filling
docs/testnet.md, docs/spike-w1-auth-mechanism.md, docs/x402-integration.md, packages/x402-client/README.md, CLAUDE.md
```

---

### Task 1: Card contract — label storage, validation, `set_label`, `CardInfo.label`

**Files:**
- Modify: `contracts/card/src/types.rs`, `contracts/card/src/lib.rs`, `contracts/card/src/test/mod.rs`, `contracts/card/src/test/auth.rs`, `contracts/card/src/test/constructor.rs`
- Create: `contracts/card/src/label.rs`, `contracts/card/src/test/label.rs`

**Interfaces:**
- Produces: `__constructor(env, owner, signer, token, policy, label: String)`; `label(env) -> String`; `set_label(env, label: String) -> Result<(), CardError>`; `CardInfo.label: String`; `CardError::InvalidLabel = 13`; `pub const MAX_LABEL_LEN: u32 = 32`; event `LabelChanged { label: String }` (topic `label_changed`).

- [ ] **Step 1: Types**

In `contracts/card/src/types.rs`: add `pub label: String,` as the **last** field of `CardInfo` (import `String` from `soroban_sdk`); append `Label,` to `DataKey`; append `InvalidLabel = 13,` to `CardError`. Update the `CardInfo` doc comment: "`label` is the owner-chosen display name (1..=32 bytes)."

- [ ] **Step 2: Failing tests**

`contracts/card/src/test/mod.rs`: add `pub const LABEL: &str = "inference-agent";` and change `setup()` to register with `(owner.clone(), agent_pk.clone(), token.clone(), default_policy(), String::from_str(&env, LABEL))` (import `soroban_sdk::String`). Do the same in `test/auth.rs` `setup_with_agent` and in `test/constructor.rs` `register_with` (add a `label: &str` parameter defaulting via a small wrapper, or pass `LABEL`). Add `mod label;`.

`contracts/card/src/test/label.rs`:
```rust
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, BytesN, Env, String};

use super::{default_policy, setup, LABEL, T0};
use crate::{Card, CardError, LabelChanged, MAX_LABEL_LEN};

fn register_with_label(env: &Env, label: &str) {
    let owner = Address::generate(env);
    let admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(admin).address();
    env.register(
        Card,
        (owner, BytesN::from_array(env, &[1u8; 32]), token, default_policy(), String::from_str(env, label)),
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
fn owner_can_rename_and_event_is_exact() {
    let f = setup();
    f.env.mock_all_auths();
    let new = String::from_str(&f.env, "ops-agent");
    f.client.set_label(&new);
    assert_eq!(f.client.label(), new);
    assert_eq!(
        f.env.events().all(),
        std::vec![LabelChanged { label: new.clone() }.to_xdr(&f.env, &f.card)]
    );
}

#[test]
fn set_label_validates() {
    let f = setup();
    f.env.mock_all_auths();
    let too_long = String::from_str(&f.env, "abcdefghijklmnopqrstuvwxyz0123456");
    assert_eq!(f.client.try_set_label(&too_long).unwrap_err().unwrap(), CardError::InvalidLabel);
    let empty = String::from_str(&f.env, "");
    assert_eq!(f.client.try_set_label(&empty).unwrap_err().unwrap(), CardError::InvalidLabel);
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
```
(`extern crate std;` and `soroban_sdk::testutils::Events` / `Event` imports as the other test modules do; copy their exact import lines.)

Run: `cargo test -p mooring-card` — Expected: compile errors (`label`, `set_label`, `LabelChanged`, 5-tuple constructor).

- [ ] **Step 3: Implement**

`contracts/card/src/label.rs`:
```rust
use soroban_sdk::String;

use crate::types::CardError;

/// Upper bound on the label length in bytes.
pub const MAX_LABEL_LEN: u32 = 32;

/// A label is 1..=32 bytes. Empty labels are rejected so a card is never nameless.
pub(crate) fn validate(label: &String) -> Result<(), CardError> {
    let len = label.len();
    if len == 0 || len > MAX_LABEL_LEN {
        return Err(CardError::InvalidLabel);
    }
    Ok(())
}
```

`contracts/card/src/lib.rs`: `mod label;` and `pub use label::MAX_LABEL_LEN;`; import `String`. Event:
```rust
#[contractevent(topics = ["label_changed"])]
pub struct LabelChanged {
    pub label: String,
}
```
Constructor: add the parameter `label: String` **after** `policy`; validate with `if label::validate(&label).is_err() { panic_with_error!(&env, CardError::InvalidLabel); }` right after the policy check; `s.set(&DataKey::Label, &label);`. Getter and setter inside `impl Card`:
```rust
    pub fn label(env: Env) -> String {
        env.storage().instance().get(&DataKey::Label).unwrap()
    }

    /// Owner: rename the card. Renaming is an on-chain transaction.
    pub fn set_label(env: Env, label: String) -> Result<(), CardError> {
        require_owner(&env);
        label::validate(&label)?;
        env.storage().instance().set(&DataKey::Label, &label);
        LabelChanged { label }.publish(&env);
        extend_instance_and_code(&env);
        Ok(())
    }
```
`info()`: add `label: s.get(&DataKey::Label).unwrap(),`.

- [ ] **Step 4: Green, lint, commit**

Run: `cargo test -p mooring-card` → all pass (the `check_auth_emits_no_events` test must still pass untouched); `make lint` clean.
```bash
git add contracts/card
git commit -m "feat(card): on-chain label with owner rename

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Factory — `create_card(label)`

**Files:**
- Modify: `contracts/factory/src/lib.rs`, `contracts/factory/src/test.rs`

**Interfaces:**
- Consumes: card constructor `(owner, signer, token, policy, label)`.
- Produces: `create_card(env, owner, signer, token, policy: card::Policy, label: String, salt: BytesN<32>) -> Address`.

- [ ] **Step 1: Failing test**

Rebuild the card WASM first (`make build`) so `contractimport!` sees the new interface. In `contracts/factory/src/test.rs` add a helper `fn label(env: &Env) -> String { String::from_str(env, "inference-agent") }` and pass `&label(&env)` after `&policy()` in every `create_card` call (7 sites). Extend `creates_card_with_deterministic_address_and_event` with `assert_eq!(c.label(), label(&env));`. Run `cargo test -p mooring-factory` → compile error (6-arg vs 7-arg).

- [ ] **Step 2: Implement**

In `create_card`, add `label: String` between `policy` and `salt`; pass `(owner.clone(), signer, token, policy, label)` to `deploy_v2`. Import `String`.

- [ ] **Step 3: Green, lint, commit**

`make test` (card + factory) green; `make lint` clean.
```bash
git add contracts/factory
git commit -m "feat(factory): create_card takes the card label

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: TypeScript — `CardInfo.label` in the client and the CLI

**Files:**
- Modify: `packages/x402-client/src/card.ts`, `packages/x402-client/test/card.test.ts`, `packages/x402-client/test/client.test.ts`, `packages/x402-client/test/precheck.test.ts`, `packages/x402-client/README.md`
- Modify: `packages/cli/src/index.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Produces: `CardInfo.label: string` (public type); `mooring status` text output line `Label: <label>` first; JSON output includes `label` automatically.

- [ ] **Step 1: Failing tests**

`test/card.test.ts`: in the raw-info fixture add `label: "inference-agent"` and assert `normalizeInfo(raw).label === "inference-agent"`; add a case where `raw.label` is missing → `normalizeInfo` throws `Error("card info has no label")` (guards against a pre-label card from the old factory). `test/client.test.ts` and `test/precheck.test.ts` fixtures gain `label: "inference-agent"` so they typecheck. `packages/cli/test/cli.test.ts` status fixture gains `label: "inference-agent"`; assert the text-mode output contains `Label: inference-agent` (add a text-mode status test if only `--json` is covered).

Run: `npm test -w @mooring/x402-client && npm test -w @mooring/cli` → failures / type errors.

- [ ] **Step 2: Implement**

`card.ts`: `CardInfo.label: string`; `RawCardInfo.label?: string`; in `normalizeInfo`: `if (typeof raw.label !== "string") throw new Error("card info has no label (card deployed from a pre-label factory?)"); … label: raw.label,`. `packages/cli/src/index.ts`: in `status` text mode print `Label: ${info.label}` as the first line. README options/CardInfo table: add `label`.

- [ ] **Step 3: Green, commit**

`npm run build && npm run typecheck && npm test` at the root green.
```bash
git add packages
git commit -m "feat(client,cli): expose the on-chain card label

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Testnet redeploy with the label, old card cancelled, fees re-measured

**Files:**
- Modify: `scripts/testnet/deploy.sh` (`--label`), `scripts/agent/src/fee32.ts` (baseline print)
- Create: `scripts/testnet/migrate-card.sh`
- Modify: `docs/testnet.md`, `docs/spike-w1-auth-mechanism.md`

**Prerequisites:** `stellar` CLI identities `mooring-*`; `deployed.testnet.json` from D2 (old factory `CCPVVXXD…F4RL`, old card `CAJPWJBF…AHCJ` holding ~10.99 USDC); `scripts/agent/.env`; `examples/merchant-server/.env` (OZ key) for the final e2e.

- [ ] **Step 1: `deploy.sh`**

Add `LABEL=${CARD_LABEL:-inference-agent}` near the policy and `--label "$LABEL"` to the `create_card` invocation. (`String` args are passed as plain text to the CLI.)

- [ ] **Step 2: `migrate-card.sh`** (owner-side, idempotent where possible)

```bash
#!/usr/bin/env bash
# Moves testnet funds from the previous card into the new one:
#   1. ensure mooring-owner holds a USDC trustline (cancel/withdraw sweep to the owner)
#   2. cancel the OLD card (owner op) → its balance lands in the owner's account
#   3. transfer that USDC from the owner into the NEW card
# Usage: scripts/testnet/migrate-card.sh <OLD_CARD_ADDRESS>   (new card read from deployed.testnet.json)
set -euo pipefail
cd "$(dirname "$0")/../.."
OLD=${1:?old card address}
NEW=$(jq -r .card deployed.testnet.json)
TOKEN=$(jq -r .token deployed.testnet.json)
USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
OWNER=$(stellar keys address mooring-owner)

if ! curl -sf "https://horizon-testnet.stellar.org/accounts/$OWNER" | jq -e --arg iss "$USDC_ISSUER" '.balances[] | select(.asset_code=="USDC" and .asset_issuer==$iss)' >/dev/null; then
  stellar tx new change-trust --source mooring-owner --network testnet --line "USDC:$USDC_ISSUER"
fi

OLD_BAL=$(stellar contract invoke --source-account mooring-owner --network testnet --id "$OLD" -- balance | tr -d '"')
echo "old card balance: $OLD_BAL"
stellar contract invoke --source-account mooring-owner --network testnet --id "$OLD" -- cancel
stellar contract invoke --source-account mooring-owner --network testnet --id "$TOKEN" -- \
  transfer --from mooring-owner --to "$NEW" --amount "$OLD_BAL"
stellar contract invoke --source-account mooring-owner --network testnet --id "$NEW" -- balance
```

- [ ] **Step 3: `fee32.ts` baseline**

Before adding merchants (right after the `allow_count == 1` guard), run the same build+sign+simulate once and print `baseline (1 merchant) minResourceFee: <n>`; keep the rest unchanged.

- [ ] **Step 4: Run**

```bash
make build
OLD_CARD=$(jq -r .card deployed.testnet.json)
scripts/testnet/deploy.sh                 # new wasm, new factory, new card with label, merchant allowlisted
scripts/testnet/migrate-card.sh "$OLD_CARD"   # old card cancelled, funds moved (expect ~10.99 USDC in the new card)
node packages/cli/dist/index.js status --card "$(jq -r .card deployed.testnet.json)" --json   # label present
cd scripts/agent && npx tsx src/fee32.ts && cd ../..        # baseline + 32-merchant numbers
npm run e2e                                 # one paid request through OZ against the new card
```
If `cancel` fails with the owner-trustline error, the change-trust step did not land; re-run it and retry. If the faucet is needed (e.g. the old card had been drained), use `scripts/testnet/fund.sh` after a faucet request to `mooring-funder`.

- [ ] **Step 5: Record**

`docs/testnet.md`: new section "Deployment v2 (on-chain label, 2026-09-13)" with the new WASM hash, factory, card, label, the migration txs (cancel + transfer), the fee numbers (baseline and 32-merchant, next to the D2 numbers), and the e2e settlement hash. Keep every earlier section. `docs/spike-w1-auth-mechanism.md`: append `Measured 2026-09-13 with the label field: <baseline> / <32-merchant> stroops`.

- [ ] **Step 6: Commit**

```bash
git add scripts docs/testnet.md docs/spike-w1-auth-mechanism.md
git commit -m "chore(testnet): redeploy with labelled cards, migrate funds, re-measure fees

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Docs, CLAUDE.md, pull request

**Files:**
- Modify: `docs/x402-integration.md` (CardInfo now has `label`; `set_label` in the owner-ops list), `README.md` (status line: "D3 in progress — part 1: on-chain labels"), `CLAUDE.md` (architecture bullet: owner ops include `set_label`; testnet deployment v2 note), `docs/design.md` (storage line: `label`).

- [ ] **Step 1: Edit the four docs** as listed; keep wording consistent with the spec (§3.6).
- [ ] **Step 2: Verify** `npm run build && npm run typecheck && npm test && make test && make lint` green.
- [ ] **Step 3: Commit and PR**

```bash
git add docs README.md CLAUDE.md
git commit -m "docs: on-chain card label across the docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/d3-web-app
```
Open PR #3 against `main`: title `D3 part 1: on-chain card label, factory v2 redeploy`, body with the change summary, the new testnet addresses, fee numbers, migration txs, and the e2e hash, ending with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01US19UXcUwgc8Nn4HwduUxY
```
Do not merge; the controller merges after CI.

---

## Self-review

**Spec coverage (§3.6):** label field + validation + `InvalidLabel` (T1); `set_label` + event (T1); `CardInfo.label` (T1, T3); factory `create_card(label)` + new factory (T2, T4); client + CLI (T3); `deployed.testnet.json` + docs (T4, T5); fee check (T4). `__check_auth` untouched (T1 constraint; existing no-events test guards it).

**Type consistency:** constructor `(owner, signer, token, policy, label)` in T1 tests, T1 code, T2 `deploy_v2` tuple; `create_card(…, policy, label, salt)` in T2 code and tests and in T4's `deploy.sh` named args; `CardInfo.label: string` in T3 client/CLI.

**Known risks:** `soroban_sdk::String::len()` returns bytes (u32) — the 32-byte tests pin it; the test env's events scoping (per top-level invocation) is why the exact-event test asserts right after `set_label`; the old card's cancel requires the owner trustline (T4 handles it).
