# Week 3 — MPP charge, guard parity, `create-mooring-agent` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Mooring card pays MPP charge sellers through the same `pay()` as x402, with local guard rails and signed receipts; a hosted seller on `api.mooring.live` accepts both protocols from a card; `npx create-mooring-agent` goes from zero to a settled payment against it.

**Architecture:** The client gains a card-aware MPP charge method (built on `mppx`'s `Method.toClient`, signing the card's auth entry with the existing `signCardAuthEntries`), a `pay()` entry that detects the protocol from the 402, and a guard/receipt layer that runs before any signing (browser-safe core, file-backed variant under a `./node` subpath). A Hono app (`apps/seller`) sells one resource through `@x402/hono` and through an mppx server method with a card-aware verifier (the stock `@stellar/mpp` verifier rejects contract payers). The kit is a template copier.

**Tech Stack:** TypeScript (NodeNext ESM), `@stellar/stellar-sdk` 17.4.0, `@x402/*` 2.32.0, `mppx` 0.22.1, Hono 4.x on Vercel, vitest, commander.

**Spec:** `docs/superpowers/specs/2026-11-26-w3-mpp-guards-kit-design.md`

## Global Constraints

- Repo language English; branch → PR → CI green → merge; never push to `main`; commits end with
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01US19UXcUwgc8Nn4HwduUxY`.
- `@stellar/stellar-sdk` stays pinned at exactly `17.4.0`; every card transfer is built with `useUpgradedAuth: false` (legacy V1 address credentials), both protocols.
- Do **not** depend on `@stellar/mpp` anywhere (its peer range `^15.1.0` excludes 17.x); depend on `mppx` 0.22.1 only and carry the charge schema.
- The main entry of `@mooring-live/x402-client` must not import `node:fs`, `node:path` or `node:os`; file-backed code lives in `src/node/` and is exported as `@mooring-live/x402-client/node`.
- Guard decisions happen before the agent key signs anything. A refusal is `GuardDenied`, never `CardPolicyDenied`.
- Amounts are USDC base-unit strings (7 decimals) internally; config values are decimal USDC strings.
- Packages: `@mooring-live/x402-client` and `@mooring-live/cli` → `0.4.0`; `create-mooring-agent` → `0.1.0`. The owner publishes.
- Never describe anything as a demo; never print or commit secrets.
- Three PRs, in order: **A** client + CLI, **B** seller + directory, **C** kit + docs + evidence + upstream branch. Each PR must be green on its own.

## Review Focus

1. A 402 that is neither x402 nor MPP (plain 402, or `WWW-Authenticate: Payment` for an unknown method such as `tempo`) → `pay()` throws `PaymentError` kind `rejected` with detail starting `not_payable`, never a bare TypeError. (Task 4 test `rejects a 402 that is neither protocol`.)
2. An MPP challenge whose `currency` is not the network's USDC → refused before any RPC call, `PaymentError` detail `unsupported_asset`. (Task 3 test.)
3. Two concurrent `pay()` calls on one card with `dailyCap` equal to one payment → exactly one reserves, the other is `GuardDenied("daily_cap")`, and after the first fails the released amount is available again. (Task 5 test `reservations keep concurrent payments under the cap`.)
4. A stop file with malformed JSON, or a `spend.json` from a previous UTC day → stop is honoured (any readable file = stopped) and the daily counter resets while `total` carries over. (Task 6 tests.)
5. The seller receives a pull credential whose `source` DID names a `C…` address that is **not** the transfer's `from`, or a transaction with two operations → 402 with a verification error and nothing broadcast. (Task 10 tests.)

---

## Part A — `@mooring-live/x402-client` 0.4.0 and `@mooring-live/cli` 0.4.0 (PR A)

Branch: `feat/w3-mpp-guards-kit` (already holds the spec). Work from the repo root; the client's tests run with `npm test -w @mooring-live/x402-client`, the CLI's with `npm test -w @mooring-live/cli` (build the client first: `npm run build -w @mooring-live/x402-client`).

### Task 1: Dependencies, package layout, `GuardDenied`

**Files:**
- Modify: `packages/x402-client/package.json` (version `0.4.0`, add `mppx: "0.22.1"` to `dependencies`, add export `./node`)
- Modify: `packages/x402-client/src/denial.ts` (add `GuardDenied`)
- Create: `packages/x402-client/src/node/index.ts` (empty re-export file for now)
- Test: `packages/x402-client/test/denial.test.ts`

**Interfaces:**
- Produces: `class GuardDenied extends Error { readonly reason: GuardReason; readonly card: string; readonly limit?: string; readonly attempted: string; readonly detail?: string }`, `type GuardReason = "stopped" | "daily_cap" | "total_cap" | "max_per_tx"`, constructor `new GuardDenied(reason, { card, attempted, limit?, detail? })`; message format `guard refused (${reason}) before signing: ${attempted} USDC attempted${limit ? `, limit ${limit}` : ""}${detail ? ` — ${detail}` : ""}`.
- Package export map gains `"./node": { "types": "./dist/node/index.d.ts", "import": "./dist/node/index.js" }`.

- [ ] **Step 1: Write the failing test** in `test/denial.test.ts`:

```ts
it("GuardDenied carries reason, card, amounts and a message that says 'before signing'", () => {
  const e = new GuardDenied("daily_cap", { card: "CBI3", attempted: "0.5", limit: "1" });
  expect(e.name).toBe("GuardDenied");
  expect(e.reason).toBe("daily_cap");
  expect(e.message).toBe("guard refused (daily_cap) before signing: 0.5 USDC attempted, limit 1");
  expect(e).not.toBeInstanceOf(CardPolicyDenied);
});
```

- [ ] **Step 2: Run** `npm test -w @mooring-live/x402-client -- test/denial.test.ts` → FAIL (`GuardDenied` is not exported).
- [ ] **Step 3: Implement** `GuardDenied` in `src/denial.ts`; export it (and `GuardReason`) from `src/index.ts`; add the `./node` export and `mppx` dependency to `package.json`; `npm install` at the root (single hoisted `mppx`); create `src/node/index.ts` with `export {};`.
- [ ] **Step 4: Run** the test → PASS; `npm run build -w @mooring-live/x402-client` emits `dist/node/index.js`.
- [ ] **Step 5: Commit** `x402-client: GuardDenied, mppx dependency, ./node subpath`.

### Task 2: MPP charge schema and challenge detection

**Files:**
- Create: `packages/x402-client/src/mpp/schema.ts`
- Create: `packages/x402-client/src/mpp/detect.ts`
- Test: `packages/x402-client/test/mpp-detect.test.ts`
- Fixture: `packages/x402-client/test/fixtures/mpp-challenge.ts` (a function that builds a 402 `Response` with a serialized stellar charge challenge via `Challenge.fromMethod`, `secretKey: "test"`, `realm: "api.mooring.live"`, request `{ amount: "10000", currency: USDC_TESTNET, recipient: PAY_TO, methodDetails: { network: "stellar:testnet", credentialTypes: ["transaction"] } }`)

**Interfaces:**
- Produces: `chargeMethod` (`Method.from({ name: "stellar", intent: "charge", schema })`, schema copied verbatim from upstream `sdk/src/charge/Methods.ts` — credential payload union `signedHash | hash | transaction`, request `{ amount, currency, recipient, description?, externalId?, methodDetails?: { network, feePayer?, credentialTypes?, reference?, issuedAt? } }`), `type ChargeChallenge = Challenge.Challenge<ChargeRequest, "charge", "stellar">`.
- Produces: `detectProtocol(res: Response): "x402" | "mpp" | null` — synchronous, headers only, never throws: `"mpp"` when `res.status === 402` and `Challenge.fromResponseList(res)` yields at least one challenge with `method === "stellar" && intent === "charge"`; `"x402"` when status 402 and either a `PAYMENT-REQUIRED` header is present or `content-type` includes `application/json` and there is no `WWW-Authenticate` header (x402's JSON-body form); otherwise `null`. The body is never read here.
- Produces: `selectChargeChallenge(res: Response): ChargeChallenge | null`.

- [ ] **Step 1: Write the failing tests**:

```ts
it("detects an MPP stellar charge 402", async () => {
  expect(detectProtocol(mppChallengeResponse())).toBe("mpp");
});
it("detects an x402 402 by header and by body", async () => {
  expect(detectProtocol(new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": "e30" } }))).toBe("x402");
  expect(detectProtocol(new Response(JSON.stringify({ accepts: [] }), { status: 402, headers: { "content-type": "application/json" } }))).toBe("x402");
});
it("is null for a plain 402, a non-402 and an unknown Payment method", async () => {
  expect(detectProtocol(new Response("nope", { status: 402 }))).toBeNull();
  expect(detectProtocol(new Response("ok", { status: 200 }))).toBeNull();
  expect(detectProtocol(tempoChallengeResponse())).toBeNull();
});
```

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** `schema.ts` and `detect.ts` with the rule above.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `x402-client(mpp): charge schema and 402 protocol detection`.

### Task 3: Card-aware MPP charge client method

**Files:**
- Create: `packages/x402-client/src/mpp/charge.ts`
- Modify: `packages/x402-client/src/scheme.ts` (export `authExpirationLedgers` already exported; extract `assertSimulationOk` and `buildTransfer`'s `AssembledTransaction.build` call into `src/transfer.ts` as `buildCardTransfer({ asset, from, to, amount, rpcUrl, passphrase })` so both protocols share it)
- Create: `packages/x402-client/src/transfer.ts`
- Test: `packages/x402-client/test/mpp-charge.test.ts`

**Interfaces:**
- Consumes: `signCardAuthEntries(tx, card, agent, expirationLedger)`, `precheck(info, merchants, terms, now)`, `readCardInfo(rpcUrl, passphrase, card)`, `readMerchants(rpcUrl, passphrase, card)`, `classifyContractError`, `CardPolicyDenied`, `PaymentError`, `chargeMethod`.
- Produces: `cardChargeMethod(opts: CardChargeOptions)` where `CardChargeOptions = CardSchemeOptions & { precheck?: boolean; usdc: string; latestLedger?: () => Promise<number> }` returning `Method.Client` built with `Method.toClient(chargeMethod, { createCredential })`.
- `createCredential({ challenge })`:
  1. `request.currency !== opts.usdc` → throw `PaymentError({ kind: "rejected", detail: "unsupported_asset: <currency>" })`.
  2. `request.methodDetails?.credentialTypes` present and not including `"transaction"` → `PaymentError` detail `mpp_push_unsupported`.
  3. If `opts.precheck !== false`: read info + merchants, `precheck(info, merchants, { payTo: recipient, amount, asset: currency }, now)`; a reason → `CardPolicyDenied(reason, "precheck", { merchant: { payTo, amount, network, url: requestUrl }, card, appUrl })`, call `onDenial`, throw.
  4. `buildCardTransfer({ asset: currency, from: card, to: recipient, amount })`.
  5. Sponsored (`methodDetails.feePayer === true`): keep the assembled tx's placeholder source (`AssembledTransaction.build` without `publicKey` already uses a zero account), sign card auth entries with `signCardAuthEntries(tx, card, agent, latestLedger + authExpirationLedgers(secondsUntil(challenge.expires) || 180))`, enforce-simulate (`tx.simulate({ useUpgradedAuth: false })`), classify a failure through the same regex as `CardExactStellarScheme.denialFromCard` (move that function to `src/denial-from-sim.ts` as `denialFromCard(err, card, merchant, requestUrl, appUrl)` and use it in both places), return `Credential.serialize({ challenge, payload: { type: "transaction", transaction: tx.built!.toXDR() }, source: \`did:pkh:stellar:${network}:${card}\` })`.
  6. Unsponsored: build with `publicKey: agent.publicKey()` as source (fetches the sequence from RPC), sign card auth entries, enforce-simulate, then `tx.sign({ signTransaction })` with the agent keypair (or `tx.built.sign(agent)` after re-assembly — the builder picks the SDK call that yields a signed envelope; the test asserts the envelope has one signature whose hint matches the agent key), same credential.
  7. `onProgress?: (e: { type: "challenge" | "signed" } ) => void` optional.
- The method's `canHandleChallenge` returns true only for `method === "stellar" && intent === "charge"` on `opts.network`.

- [ ] **Step 1: Write the failing tests** (stub `buildCardTransfer` and the readers through a `deps` parameter on `cardChargeMethod` — add `deps?: { buildTransfer?, readCardInfo?, readMerchants?, latestLedger? }` as a second argument so tests inject fakes; the x402 scheme tests already do this with `protected` methods, here a deps object is cleaner):

```ts
it("refuses a non-USDC currency before touching the RPC", async () => {
  const rpc = vi.fn();
  const m = cardChargeMethod({ ...base, usdc: USDC }, { readCardInfo: rpc, buildTransfer: rpc });
  await expect(m.createCredential({ challenge: challengeWith({ currency: "COTHER" }) })).rejects.toMatchObject({ name: "PaymentError", detail: expect.stringMatching(/^unsupported_asset/) });
  expect(rpc).not.toHaveBeenCalled();
});
it("refuses a server that only accepts push credentials", async () => { /* credentialTypes: ["signedHash"] → detail "mpp_push_unsupported" */ });
it("precheck denial is a CardPolicyDenied at stage precheck and nothing is built", async () => { /* merchants [] → reason not_allowlisted */ });
it("sponsored challenge: signs only the card auth entry and returns a transaction credential with a card DID", async () => {
  // fake buildTransfer returns the fixture AssembledTransaction from scheme.test.ts; assert
  // Credential.deserialize(cred).payload.type === "transaction", .source === `did:pkh:stellar:stellar:testnet:${CARD}`,
  // decoded envelope: 1 op, 1 auth entry for CARD with sorobanCredentialsAddress (V1), 0 envelope signatures
});
it("unsponsored challenge: the agent account is the source and signs the envelope", async () => {
  // envelope.source === agent.publicKey(), signatures.length === 1
});
it("an enforcing-simulation failure naming the card becomes CardPolicyDenied at stage simulate", async () => { /* reuse the diagnostic text fixture from scheme.test.ts */ });
```

- [ ] **Step 2: Run** `npm test -w @mooring-live/x402-client -- test/mpp-charge.test.ts` → FAIL.
- [ ] **Step 3: Implement** `src/transfer.ts`, `src/denial-from-sim.ts`, `src/mpp/charge.ts`; refactor `scheme.ts` to use them (its tests must still pass unchanged).
- [ ] **Step 4: Run** the whole client suite → PASS; `npm run typecheck -w @mooring-live/x402-client` clean.
- [ ] **Step 5: Commit** `x402-client(mpp): card-aware MPP charge method (pull, sponsored and agent-paid)`.

### Task 4: `pay()` with protocol detection

**Files:**
- Create: `packages/x402-client/src/pay.ts`
- Modify: `packages/x402-client/src/client.ts` (`createMooringFetch` delegates to the same core so it gains MPP), `src/index.ts` (export `pay`, `PayResult`, `PayOptions`, `detectProtocol`)
- Test: `packages/x402-client/test/pay.test.ts`

**Interfaces:**
- Produces: `interface PayOptions extends MooringClientOptions { guard?: Guard; onReceipt?: (r: Receipt) => void; fetch?: typeof fetch; usdc?: string }` (`usdc` defaults from `deploymentFor(network).usdc`).
- Produces: `interface PayResult { response: Response; protocol: "x402" | "mpp" | "none"; settlement: { txHash: string; amount: string; payTo: string; asset: string; network: string } | null; receipt: Receipt | null }`.
- Produces: `pay(url: string | URL, init: RequestInit | undefined, opts: PayOptions): Promise<PayResult>`. Flow: `transport(url, init)` once → `detectProtocol(res)`: `null` and status 402 → `PaymentError({ kind: "rejected", detail: "not_payable: 402 without x402 or MPP terms" })`; `null` and not 402 → `{ response, protocol: "none", settlement: null, receipt: null }`. `"x402"` → hand the original 402 response to `@x402/fetch`'s flow by calling the existing wrapped fetch again on the URL (one extra request; acceptable and documented) and read `getSettlement`. `"mpp"` → `Mppx.create({ methods: [cardChargeMethod(...)], polyfill: false, fetch: transport }).fetch(url, init)`, then `Receipt.fromResponse(res)` → `settlement.txHash = receipt.reference`.
- Guard integration is Task 5; this task lands `pay()` with `guard` ignored (and `receipt: null`).

- [ ] **Step 1: Write the failing tests** with a scripted `fetch` (first call 402 of each kind, second call 200 with `PAYMENT-RESPONSE` / `Payment-Receipt`):

```ts
it("pays an x402 seller and reports protocol x402 with the settlement hash", async () => { /* PAYMENT-RESPONSE base64 {success:true,transaction:"ab..",network:"stellar:testnet"} */ });
it("pays an MPP seller and reports protocol mpp with the receipt reference as txHash", async () => { /* Payment-Receipt with reference "cd.." */ });
it("returns a non-402 untouched with protocol none", async () => {});
it("rejects a 402 that is neither protocol", async () => { /* detail starts with not_payable */ });
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `pay.ts`; make `createMooringFetch` call `pay` and return `result.response` (keep its thrown-error contract and existing tests green).
- [ ] **Step 4: Run** the suite → PASS.
- [ ] **Step 5: Commit** `x402-client: pay() picks x402 or MPP charge from the seller's 402`.

### Task 5: Guard core (`MemoryGuard`), reservations, receipts

**Files:**
- Create: `packages/x402-client/src/guard/types.ts`, `src/guard/memory.ts`, `src/guard/config.ts`, `src/receipts.ts`
- Modify: `packages/x402-client/src/pay.ts` (wire the guard and receipts), `src/index.ts`
- Test: `packages/x402-client/test/guard-memory.test.ts`, `test/receipts.test.ts`, additions to `test/pay.test.ts`

**Interfaces:**
- `interface GuardTerms { card: string; payTo: string; amount: string /* base units */; asset: string; network: string; url?: string }`
- `interface Reservation { id: string; card: string; amount: string }`
- `interface Guard { check(t: GuardTerms): Promise<GuardDenied | null>; reserve(t: GuardTerms): Promise<Reservation> /* throws GuardDenied */; commit(r: Reservation, outcome: "settled" | "denied" | "failed"): Promise<void>; stop(reason?: string, card?: string): Promise<void>; resume(card?: string): Promise<void>; isStopped(card: string): Promise<boolean>; snapshot(card: string): Promise<GuardSnapshot> }`
- `interface GuardSnapshot { day: string; daily: string; total: string; reserved: string; caps: GuardCaps; stopped: boolean }`
- `interface GuardCaps { dailyCap?: string; totalCap?: string; maxPerTx?: string }` (base units); `interface GuardConfig { dailyCap?: string; totalCap?: string; maxPerTx?: string }` (decimal USDC); `parseGuardConfig(cfg: GuardConfig): GuardCaps` (`"1"` → `"10000000"`, more than 7 decimals → throws `RangeError`); `guardCapsFromEnv(env: NodeJS.ProcessEnv): GuardConfig` reads `MOORING_DAILY_CAP`, `MOORING_TOTAL_CAP`, `MOORING_MAX_PER_TX`.
- `class MemoryGuard implements Guard { constructor(caps?: GuardCaps, now?: () => Date) }`; per-card state; "day" is `now().toISOString().slice(0, 10)`; a day change resets `daily` and reservations are counted toward both caps.
- Receipts: `interface Receipt { v: 1; id: string; ts: string; protocol: "x402" | "mpp"; card: string; agent: string; payTo: string; amount: string; asset: string; network: string; url?: string; status: "settled" | "denied" | "failed"; txHash?: string; reason?: string; sig: string }`; `canonicalReceipt(r: Omit<Receipt, "sig">): string` (JSON with keys sorted recursively, no whitespace); `signReceipt(r, agent: Keypair): Receipt` (`sig` = hex of `agent.sign(utf8(canonical))`); `verifyReceipt(r: Receipt): boolean` (uses `Keypair.fromPublicKey(r.agent)`); `receiptId()` = 16 random bytes hex (use `crypto.getRandomValues`, available in browsers and Node ≥ 20).
- `pay()` order: `guard.isStopped` → `guard.reserve(terms)` (terms known from the 402: x402 `accepts` entry selected for the network/USDC, MPP `request`) → protocol payment → `commit(r, outcome)` → `onReceipt(signReceipt(...))`. A `GuardDenied` and a `CardPolicyDenied` both produce a `denied` receipt; a `PaymentError` a `failed` one; receipts are emitted via `onReceipt` only (no I/O here).

- [ ] **Step 1: Write the failing tests**:

```ts
// guard-memory.test.ts
it("refuses above max_per_tx, then daily_cap, then total_cap, in that order", ...);
it("reservations keep concurrent payments under the cap", async () => {
  const g = new MemoryGuard({ dailyCap: "10000" });
  const [a, b] = await Promise.allSettled([g.reserve(terms("10000")), g.reserve(terms("10000"))]);
  expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
  await g.commit((a.status === "fulfilled" ? a : b as any).value, "failed");
  await expect(g.reserve(terms("10000"))).resolves.toBeTruthy();
});
it("stop refuses everything until resume; a card-scoped stop refuses only that card", ...);
it("daily resets on a new UTC day, total carries over", ...);
it("parseGuardConfig converts decimal USDC and rejects more than 7 decimals", () => {
  expect(parseGuardConfig({ dailyCap: "1" })).toEqual({ dailyCap: "10000000" });
  expect(() => parseGuardConfig({ maxPerTx: "0.00000001" })).toThrow(RangeError);
});
// receipts.test.ts
it("signs a receipt the agent's public key verifies, and a changed amount fails", ...);
it("canonical form sorts keys and omits sig", ...);
// pay.test.ts additions
it("refuses before signing when the guard says stop and emits a denied receipt", ...);
it("emits a settled receipt with the tx hash after an MPP payment", ...);
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the files above and wire `pay.ts`.
- [ ] **Step 4: Run** the suite → PASS; confirm with `grep -rn "node:fs" packages/x402-client/src --include=*.ts | grep -v "src/node/"` → no output.
- [ ] **Step 5: Commit** `x402-client(guard): memory guard with reservations, signed receipts, pay() wiring`.

### Task 6: File-backed guard, stop file, receipt ledger and export (`./node`)

**Files:**
- Create: `packages/x402-client/src/node/fileGuard.ts`, `src/node/lock.ts`, `src/node/receiptsFile.ts`, `src/node/index.ts` (exports `fileGuard`, `defaultStateDir`, `appendReceipt`, `readReceipts`, `exportReceipts`, `loadGuardConfig`)
- Test: `packages/x402-client/test/node-file-guard.test.ts`, `test/node-receipts.test.ts` (use `fs.mkdtemp` under `os.tmpdir()`)

**Interfaces:**
- `defaultStateDir(env = process.env): string` → `env.MOORING_HOME ?? path.join(os.homedir(), ".mooring")`.
- `loadGuardConfig(cwd: string, env = process.env): GuardConfig` — precedence: `mooring.guard.json` in `cwd` (keys `dailyCap`, `totalCap`, `maxPerTx`, all optional decimal strings) over env values; a malformed file throws with the path in the message.
- `fileGuard(opts: { stateDir: string; caps?: GuardCaps; now?: () => Date }): Guard` — state in `spend.json` `{ v: 1, cards: { [card]: { day, daily, total, reservations: { [id]: { amount, at } } } } }`, stop in `stop` as `{ at, reason?, cards?: string[] }` (absent `cards` = global); every read-modify-write under `withLock(stateDir)` from `lock.ts`: create `spend.lock` with `O_EXCL`, retry every 50 ms up to 2 000 ms, treat a lock older than 30 s as stale and replace it; reservations older than 10 minutes are dropped on read (a crashed process must not pin the cap forever).
- `appendReceipt(stateDir, r: Receipt)`: one JSON line appended to `receipts.jsonl` (`mkdir -p` first). `readReceipts(stateDir, filter?: { since?: string; card?: string })`. `exportReceipts(stateDir, { format: "csv" | "json", since?, card? }): string` — CSV header `id,ts,protocol,card,agent,payTo,amount,asset,network,url,status,txHash,reason,sig`, RFC 4180 quoting.

- [ ] **Step 1: Write the failing tests**:

```ts
it("persists counters across guard instances and processes (two instances, one dir)", ...);
it("a malformed stop file still means stopped", async () => { await fs.writeFile(path.join(dir, "stop"), "{not json"); expect(await g.isStopped(CARD)).toBe(true); });
it("drops reservations older than 10 minutes", ...);
it("loadGuardConfig prefers mooring.guard.json over env", ...);
it("exportReceipts csv has the fixed header and quotes commas", ...);
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run build -w @mooring-live/x402-client` and check `node -e "import('@mooring-live/x402-client/node').then(m=>console.log(Object.keys(m)))"` from `packages/cli` lists the five exports.
- [ ] **Step 5: Commit** `x402-client(node): file-backed guard, stop file, receipt ledger and export`.

### Task 7: MPP sequence serialization and `sequence_conflict`

**Files:**
- Modify: `packages/x402-client/src/mpp/charge.ts` (module-level `Map<agentPublicKey, Promise<void>>` mutex around steps 4–6 of the unsponsored path), `src/pay.ts` (retry once on `sequence_conflict`, reservation kept)
- Test: additions to `test/mpp-charge.test.ts`, `test/pay.test.ts`

**Interfaces:**
- `PaymentError` detail `sequence_conflict` when the seller's response or the simulation error text contains `txBAD_SEQ` / `tx_bad_seq`.

- [ ] **Step 1: Tests**: `it("serializes two unsponsored MPP credentials for one agent key", …)` (fake `buildTransfer` records call order and resolves on a deferred; the second build must not start before the first credential is returned); `it("retries once on sequence_conflict keeping the reservation, then fails", …)` (guard `commit` called once with `failed`, `reserve` once).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `x402-client(mpp): serialize agent-paid payments per key; sequence_conflict retry`.

### Task 8: CLI 0.4.0 — `pay` through `pay()`, `stop`/`resume`/`guard`/`receipts`

**Files:**
- Modify: `packages/cli/package.json` (0.4.0, client dep `0.4.0`), `packages/cli/src/index.ts` (version string, `CliDeps` gains `pay`, `guardFor: (stateDir, caps) => Guard`, `appendReceipt`, `exportReceipts`, `readReceipts`, `stateDir: () => string`, `env`, `cwd`)
- Create: `packages/cli/src/guard-commands.ts` (`registerGuardCommands(program, deps)`)
- Test: `packages/cli/test/cli.test.ts` additions, `packages/cli/test/guard-commands.test.ts`

**Interfaces:**
- `mooring pay <url> --card C… [--daily-cap <usdc>] [--total-cap <usdc>] [--max-per-tx <usdc>] [--no-guard] [--json]`. Output lines on success: `HTTP 200`, `Protocol: mpp`, `Settlement: <hash> (stellar:testnet)`, `Receipt: <id>`, then the body. On `GuardDenied`: `refused before signing: <reason> (<attempted> USDC attempted, limit <limit>)`, exit code 2, a denied receipt is still appended. On `CardPolicyDenied` as today. `--json` prints `{ protocol, settlement, receipt }`.
- `mooring stop [--reason <text>] [--card C…]` → prints `stopped (<stateDir>/stop)`; `mooring resume [--card C…]`; `mooring guard --card C…` prints the `GuardSnapshot` as a table (`Day`, `Spent today`, `Spent total`, `Reserved`, caps, `Stopped`) or `--json`.
- `mooring receipts export --csv | --json [--since <ISO>] [--card C…]` writes to stdout; `mooring receipts verify [<file>]` (default the ledger) prints `verified N receipts` or lists the bad ids and exits 1.

- [ ] **Step 1: Tests** (fake deps as the existing `pay` tests do):

```ts
it("mooring pay prints the protocol and receipt id and appends a settled receipt", ...);
it("mooring pay with --daily-cap 0.0005 is refused before signing with exit 2 and a denied receipt", async () => {
  // fake pay rejects with GuardDenied("daily_cap", { card, attempted: "0.001", limit: "0.0005" }) — assert the exact stdout line
  // "refused before signing: daily_cap (0.001 USDC attempted, limit 0.0005)"
});
it("mooring stop writes the stop file and mooring resume removes it", ...);
it("mooring receipts export --csv prints the header first", ...);
it("mooring receipts verify exits 1 when a signature does not verify", ...);
```

- [ ] **Step 2: Run** `npm test -w @mooring-live/cli` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `cli 0.4.0: pay via pay(), stop/resume/guard/receipts`.

### Task 9: PR A

- [ ] `npm run build && npm run typecheck && npm test` at the root → green; update `packages/x402-client/README.md` (MPP, guard, `./node`) and `packages/cli/README.md` if present (new commands).
- [ ] Push `feat/w3-mpp-guards-kit`, open PR "W3: MPP charge from a card, guard parity, CLI 0.4.0" (body ends with the required lines), wait for CI, merge, pull `main`.

---

## Part B — `apps/seller` on `api.mooring.live` and the directory (PR B)

Branch `feat/w3-seller` from `main`.

### Task 10: Seller app with x402 and card-aware MPP charge

**Files:**
- Create: `apps/seller/package.json` (`@mooring/seller`, private, scripts `dev` (`tsx watch src/dev.ts`), `build` (`tsc`), `typecheck`, `test`; deps `hono ^4.13`, `@hono/node-server ^2.1`, `@x402/hono 2.32.0`, `@x402/core 2.32.0`, `@x402/stellar 2.32.0`, `mppx 0.22.1`, `@stellar/stellar-sdk 17.4.0`, `@mooring-live/x402-client` workspace), `apps/seller/tsconfig.json`, `apps/seller/vercel.json` (`{ "framework": null, "installCommand": "cd ../.. && npm ci", "buildCommand": "cd ../.. && npm run build -w @mooring-live/x402-client -w @mooring/seller" }`), `apps/seller/api/index.ts` (`export default handle(app)` from `hono/vercel`), `apps/seller/src/app.ts`, `src/config.ts`, `src/quotes.ts`, `src/mpp-card-charge.ts`, `src/dev.ts`
- Test: `apps/seller/test/app.test.ts`, `apps/seller/test/mpp-card-charge.test.ts`
- Modify: root `package.json` nothing (workspaces glob `apps/*` already includes it); `.github/workflows/ci.yml` web job runs `npm test -w @mooring/seller` and `npm run typecheck -w @mooring/seller` after the web steps

**Interfaces:**
- `createSellerApp(cfg: SellerConfig): Hono` with `SellerConfig = { network: "stellar:testnet" | "stellar:pubnet"; payTo: string; usdc: string; rpcUrl: string; facilitator: FacilitatorClient; mppSecretKey: string; priceBaseUnits: "10000"; rpc?: ChargeRpc /* injectable for tests */ }`.
- Routes: `GET /` → `{ name: "Mooring example seller", network, payTo, resources: [{ path: "/quote", protocol: "x402", amount: "10000", asset: usdc }, { path: "/quote/mpp", protocol: "mpp", amount: "10000", asset: usdc }], docs: "https://github.com/berkay1532/mooring/blob/main/docs/seller.md" }`; `GET /health` → `{ ok: true }`; `GET /quote` behind `@x402/hono` `paymentMiddleware` (price `"$0.001"`, `payTo`, `network`) → `{ quote, author, paidWith: "x402", ts }` from `quotes.ts` (a fixed list of ten public-domain lines, picked by `Date.now() % 10`); `GET /quote/mpp` behind `mppx/hono` `payment(mppx.charge, { amount: "10000", currency: usdc, recipient: payTo, methodDetails: { network, credentialTypes: ["transaction"] } })` → same shape with `paidWith: "mpp"`.
- `cardChargeServer(opts: { network; usdc; payTo; rpc: ChargeRpc; now?: () => Date })` = `Method.toServer(chargeMethod, { request, verify })` where `ChargeRpc = { simulate(xdr: string): Promise<{ ok: true } | { ok: false; error: string }>; send(xdr: string): Promise<{ hash: string }>; wait(hash: string): Promise<"SUCCESS" | "FAILED" | "NOT_FOUND">; latestLedger(): Promise<number> }` (production implementation over `rpc.Server`). `verify` rules, in order, each failure → throw `Error` with the listed message (mppx turns it into a 402):
  1. `payload.type !== "transaction"` → `"only pull-mode transaction credentials are accepted"`.
  2. `source` must parse as `did:pkh:stellar:<network>:<addr>` with `<network>` equal to `opts.network` and `<addr>` a valid `G…` (`StrKey.isValidEd25519PublicKey`) or `C…` (`StrKey.isValidContract`) → `"credential source is not a Stellar DID on this network"`.
  3. Decode the envelope; exactly one operation, `invokeHostFunction`, `invokeContract` on `currency` calling `transfer(from, to, amount)` with `from === sourceAddr`, `to === opts.payTo`, `amount === BigInt(request.amount)`; `tx.source` must be a `G…` that is not `opts.payTo` and not the all-zeros account (sponsored envelopes are refused with `"this seller does not sponsor fees"`) → `"transaction is not the requested transfer"`.
  4. Auth entries: every entry has address credentials (V1 or V2), no sub-invocations, `signatureExpirationLedger` in `(latestLedger, latestLedger + 120]`; for a `G…` authorizer additionally `verifyAuthEntrySignature` (port the upstream function into `src/verify-auth.ts`); at least one entry's address equals `from` and covers the transfer → `"no authorization entry authorizes the transfer"`.
  5. `rpc.simulate(xdr)` must be ok → `"simulation failed: <error>"` (this is where a card's `__check_auth` refusal surfaces; the message keeps the host diagnostic so the client's classifier works).
  6. `rpc.send(xdr)` → `rpc.wait(hash)` until `SUCCESS` (poll every 1 s, 30 attempts) → `Receipt.from({ method: "stellar", status: "success", timestamp, reference: hash })`; `FAILED` → `"transaction failed on-chain: <hash>"`.
- Store: `Store.memory()` (documented limitation in `docs/seller.md`).

- [ ] **Step 1: Write the failing tests** (`app.test.ts` with a fake facilitator that returns `isValid: true`/`success: true` for x402 and `ChargeRpc` fakes for MPP; `mpp-card-charge.test.ts` builds envelopes with the client's `cardChargeMethod` from Part A against a fake RPC, both for a `G…` payer (agent as from) and for a card):

```ts
it("GET / lists both resources with their protocols", ...);
it("GET /quote answers 402 with x402 terms, then 200 with a settlement after payment", ...);
it("GET /quote/mpp answers 402 with a WWW-Authenticate Payment challenge for stellar/charge", ...);
it("accepts a card-paid pull credential and returns a Payment-Receipt with the tx hash", ...);
it("rejects a DID that is not the transfer's from", ...);
it("rejects a transaction with two operations", ...);
it("rejects a sponsored (all-zeros source) envelope", ...);
it("rejects an expired auth entry", ...);
it("turns a simulation failure into a 402 that keeps the host diagnostic", ...);
```

- [ ] **Step 2: Run** `npm test -w @mooring/seller` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run typecheck -w @mooring/seller`.
- [ ] **Step 5: Commit** `seller: Hono app on Vercel — x402 /quote and card-aware MPP charge /quote/mpp`.

### Task 11: Seller runbook and deployment

**Files:**
- Create: `docs/seller.md` (what it sells, env table — `STELLAR_NETWORK`, `SELLER_PAY_TO`, `OZ_API_KEY`, `FACILITATOR_URL`, `MPP_SECRET_KEY`, `SOROBAN_RPC_URL` — Vercel project steps: new project from the repo, root `apps/seller`, Node 20, env, domain `api.mooring.live` CNAME → `cname.vercel-dns.com`; the memory-store limitation; the "stock MPP servers reject contract payers" note with the upstream PR link placeholder)
- Modify: `README.md` (one line under the packages list), `CLAUDE.md` (progress)

- [ ] **Step 1:** Write the runbook. **Step 2:** Owner creates the Vercel project and DNS (hand them the exact steps from the runbook, one at a time, in chat). **Step 3:** Verify from the terminal: `curl -i https://api.mooring.live/quote` → 402 with `PAYMENT-REQUIRED`; `curl -i https://api.mooring.live/quote/mpp` → 402 with `WWW-Authenticate: Payment …`.
- [ ] **Step 4: Commit** `docs: seller runbook`.

### Task 12: Directory — `mooring` source, `protocol`, MPP in the resolver and Browse

**Files:**
- Modify: `apps/web/lib/directory/types.ts` (`DirectorySource` gains `"mooring"` first in `SOURCE_PRIORITY`; `DirectoryEntry` gains `protocol: "x402" | "mpp"`), every source normalizer sets `protocol: "x402"` (`mpprouter` sets `"mpp"`), `lib/directory/snapshot.ts` (loader `["mooring", fetchMooringSeller]`)
- Create: `apps/web/lib/directory/sources/mooring.ts` (`MOORING_SELLER_URL = process.env.MOORING_SELLER_URL ?? "https://api.mooring.live"`; `normalizeMooringSeller(json, base)` maps the `/` document's `resources[]` to entries with `name` `"Mooring example seller · x402"` / `"… · MPP"`, `verified: true`, `proxy: false`, `tags: ["example", protocol]`)
- Modify: `apps/web/lib/merchants/terms.ts` (`parseMppChallenge(header: string | null): ParsedTerms | null` — reads the `WWW-Authenticate` value with `mppx`'s `Challenge.deserializeList`, keeps `stellar`/`charge` challenges, maps `recipient→payTo`, `currency→asset`, `amount`, `methodDetails.network→network`, `scheme: "mpp"`), `lib/merchants/resolve.ts` (`interpret` tries `payment-required`/body first, then `www-authenticate`; `not_x402` message becomes "That URL did not answer with x402 or MPP payment terms…"), `components/merchants/BrowseServices.tsx` (an `MPP` pill next to `MCP`), `components/merchants/MerchantConfirmModal.tsx` (shows "Pays through MPP charge" when `scheme === "mpp"`)
- Test: `apps/web/test/unit/directory-sources.test.ts` (+ `normalizeMooringSeller` on a fixture of the `/` document), `directory-merge.test.ts` (`mooring` wins dedupe), `merchants-resolve.test.ts` (+ MPP 402 → `ok` with `scheme: "mpp"`), `browse-services.test.tsx` (+ MPP pill), fixture `apps/web/test/fixtures/directory/mooring-seller.json`

- [ ] **Step 1:** Write the failing tests (names as above; the MPP resolver test uses a header produced by `Challenge.fromMethod(chargeMethod, { secretKey: "t", realm: "api.mooring.live", request: {...} })` serialized with `Challenge.serialize`).
- [ ] **Step 2: Run** `npm test -w @mooring/web` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, `npm run typecheck -w @mooring/web`; Playwright `directory.spec.ts` still green (stubbed directory gains `protocol` in its fixtures).
- [ ] **Step 5: Commit** `web(directory): first-party seller source, protocol field, MPP challenges in the resolver`.

### Task 13: PR B

- [ ] Root `npm run build && npm run typecheck && npm test`; push, PR "W3: hosted seller (x402 + MPP charge) and directory protocol support", CI, merge, pull.

---

## Part C — kit, docs, upstream branch, evidence (PR C)

Branch `feat/w3-kit-evidence` from `main`.

### Task 14: `create-mooring-agent`

**Files:**
- Create: `packages/create-mooring-agent/package.json` (`name: "create-mooring-agent"`, `version: "0.1.0"`, `bin: { "create-mooring-agent": "./dist/index.js" }`, `files: ["dist", "template"]`, deps none at runtime beyond Node; dev `vitest`, `typescript`, `tsx`), `tsconfig.json`, `src/index.ts`, `src/scaffold.ts`, `template/package.json`, `template/.env.example`, `template/src/agent.ts`, `template/src/status.ts`, `template/README.md`, `template/tsconfig.json`, `template/.gitignore`
- Test: `packages/create-mooring-agent/test/scaffold.test.ts`

**Interfaces:**
- `scaffold(opts: { dir: string; name: string; service: string; network: string; templateDir: string }): Promise<string[]>` (written files). Refuses a non-empty `dir` with `Error("directory is not empty")`. Substitutes `__NAME__`, `__SERVICE__`, `__NETWORK__` in `package.json`, `.env.example`, `README.md`.
- CLI: `create-mooring-agent <dir> [--service https://api.mooring.live/quote] [--network stellar:testnet]`; prints the three next steps verbatim from the template README's "Next steps" section.
- `template/src/agent.ts`: loads `.env` (`dotenv`), requires `MOORING_CARD`, `AGENT_SECRET`, `MOORING_SERVICE`; `fileGuard({ stateDir: defaultStateDir(), caps: parseGuardConfig(loadGuardConfig(process.cwd())) })`; `pay(MOORING_SERVICE, undefined, { card, agent, network, guard, onReceipt: (r) => appendReceipt(stateDir, r) })`; prints `Paid <amount> USDC to <payTo> via <protocol>`, `tx <hash> — https://stellar.expert/explorer/testnet/tx/<hash>`, `Remaining this period: <x> USDC` (from `readCardInfo`), `Receipt <id> → <stateDir>/receipts.jsonl`; on `GuardDenied` prints `Refused before signing: <reason>`; on `CardPolicyDenied` prints the reason and, for `not_allowlisted`, the allow link; on `insufficient_balance` prints `Fund the card at https://app.mooring.live (card <address>)`. Exit code 1 on any refusal.
- `template/package.json`: deps `@mooring-live/x402-client ^0.4.0`, `@stellar/stellar-sdk 17.4.0`, `dotenv ^16`, `tsx ^4`, `typescript ^5`; scripts `pay: tsx src/agent.ts`, `status: tsx src/status.ts`.

- [ ] **Step 1: Tests**: `it("scaffolds the template with substitutions and refuses a non-empty dir", …)` (asserts `.env.example` contains `MOORING_SERVICE=https://api.mooring.live/quote` and `package.json` name); `it("the scaffolded project typechecks against the workspace client", …)` (copies `packages/x402-client` build into the temp project's `node_modules/@mooring-live/x402-client` via `npm pack` or a symlink, runs `tsc --noEmit`); `it("agent.ts pays an in-process seller and prints the hash", …)` (starts `createSellerApp` from Part B on a random port with fake facilitator/RPC, runs `agent.ts` with `tsx` as a child process, asserts stdout contains `via x402` and `tx `).
- [ ] **Step 2: Run** `npm test -w create-mooring-agent` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run build -w create-mooring-agent`; manual: `node packages/create-mooring-agent/dist/index.js /tmp/kit-smoke` prints the next steps.
- [ ] **Step 5: Commit** `create-mooring-agent 0.1.0: scaffold a paying agent against the hosted seller`.

### Task 15: Docs and quickstart

**Files:**
- Modify: `README.md` (Quickstart rewritten: `npx create-mooring-agent my-agent` → three steps → `npm run pay`), `docs/x402-integration.md` (new sections "Paying MPP charge sellers" — wire format, pull only, agent pays the fee, the server-side limitation and the upstream branch — and "Guard rails and receipts" — config precedence, decision order, receipt format, `verifyReceipt`), `docs/web-app.md` ("Browse services" gains the MPP pill and the first-party seller), `CLAUDE.md` (progress line)
- [ ] Write; `npm run typecheck` unaffected. **Commit** `docs: MPP charge, guard rails, kit quickstart`.

### Task 16: Upstream branch for `stellar/stellar-mpp-sdk`

- [ ] `gh repo fork stellar/stellar-mpp-sdk --clone=false` (owner's account, decided 2026-11-26); clone the fork into the scratchpad, branch `contract-payers-pull-mode` from `main`.
- [ ] Change `publicKeyFromDID` → `payerFromDID` accepting `StrKey.isValidContract` as well; in `validateAuthEntries` skip `verifyAuthEntrySignature` when the authorizer is `scAddressTypeContract` (comment: validated by the enforce-mode simulation below); the push path keeps `Keypair.fromPublicKey` (contract payers cannot push). Add two tests mirroring upstream's style: a `C…` DID in pull mode verifies; a `C…` DID in push mode is rejected with the existing message.
- [ ] Run upstream's test suite for the charge server; push the branch to the fork; write `docs/upstream/stellar-mpp-sdk-contract-payers.md` with the PR title "charge/server: accept contract (custom account) payers in pull mode", the body, and the compare URL; the owner clicks "Create pull request".
- [ ] **Commit** (in Mooring) `docs(upstream): prepared stellar-mpp-sdk PR for contract payers`.

### Task 17: Week-3 evidence

- [ ] With the published or workspace-built CLI and the owner's `cli card` (`CBI3…V7RY`, agent key from `stellar keys`, agent account funded by friendbot): `mooring pay https://api.mooring.live/quote/mpp --card CBI3…` → record `Protocol: mpp`, settlement hash; verify on stellar.expert (transfer from the card to `SELLER_PAY_TO`).
- [ ] `mooring pay … --daily-cap 0.0005` → `refused before signing: daily_cap …`; `mooring stop --reason "evidence"` then `mooring pay …` → `refused before signing: stopped`; `mooring resume`.
- [ ] `mooring receipts export --csv` (first five lines) and `mooring receipts verify`.
- [ ] `npx create-mooring-agent /tmp/mooring-kit-evidence` → fill `.env` from the same card/key → `npm run pay` transcript (x402 against `/quote`).
- [ ] Record all of it in `docs/testnet.md` under "Week 3 — MPP charge, guard rails, kit (2026-11-…)"; update the sprint memory. **Commit** `docs(testnet): week-3 evidence`.

### Task 18: PR C and publishing

- [ ] Root build/typecheck/test; push; PR "W3: create-mooring-agent, docs, upstream branch, evidence"; CI; merge.
- [ ] Hand the owner the publish commands (`npm publish -w @mooring-live/x402-client`, `-w @mooring-live/cli`, `-w create-mooring-agent`, each with OTP) and the upstream "Create pull request" link; after publishing, re-run the kit from npm once and note it in `docs/testnet.md`.
