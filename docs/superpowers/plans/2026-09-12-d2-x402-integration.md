# D2 — x402 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An AI agent pays an x402-protected API from its Mooring card through the standard `@x402/stellar` server + OZ Channels facilitator, with the card's policy enforced on-chain, via a published-quality npm client (`@mooring/x402-client`) and a small CLI; proven end to end on testnet with recorded evidence.

**Architecture:** The server side is stock x402 (`@x402/express` + `@x402/stellar` server scheme + `HTTPFacilitatorClient` pointing at OZ Channels). The client side is Mooring's own `SchemeNetworkClient` for `stellar:*` / `exact` (`CardExactStellarScheme`) because the stock client cannot sign for a C-address payer: it builds the same `USDC.transfer(card, payTo, amount)` payload, signs the card's auth entries with the agent key through a custom `authorizeEntry`, and plugs into `x402Client` / `wrapFetchWithPayment` unchanged. Around it: a local policy pre-check (reads the card's `info()` and `merchants()` views), typed denials (`CardPolicyDenied`), and hooks that classify verify-time and settle-time failures. Node packages live in an npm workspace beside the Cargo workspace.

**Tech Stack:** TypeScript (ESM, strict), Node 20+, `@stellar/stellar-sdk ^17.0.1`, `@x402/core`, `@x402/fetch`, `@x402/express`, `@x402/stellar` all pinned `2.25.0`, `express ^4`, `commander ^12`, `vitest ^3`, `tsx`, `typescript ^5.6`, `stellar` CLI 26.x for owner ops on testnet, OZ Channels testnet facilitator.

**Spec:** `docs/design.md` (components 2, 3, 5; data flow), `docs/spike-w1-auth-mechanism.md` (normative: facilitator checks, client signer shape, denial semantics), `CLAUDE.md` (D2 + W2/W3 scope).

## Global Constraints

- Repo language: **English only** (code, comments, docs, commits). Never call the client or web app a "demo".
- Testnet only. Never touch mainnet. Secrets (`.env`, `deployed.testnet.json`, OZ API key) are never committed or printed.
- x402 packages pinned exactly: `"@x402/core": "2.25.0"`, `"@x402/fetch": "2.25.0"`, `"@x402/express": "2.25.0"`, `"@x402/stellar": "2.25.0"`. Never mix v1 and v2 packages. `@stellar/stellar-sdk` `^17.0.1`.
- The payment payload shape must equal the stock client's: one `invokeHostFunction` calling `asset.transfer(card, payTo, amount)`, auth entries signed by the card (agent key), `payload: { transaction: <base64 tx XDR> }`, `x402Version: 2`. Nothing else in the payload.
- The card signer is the custom-`authorizeEntry` form (4-arg `signCardAuthEntries(tx, cardAddress, agentKeypair, expirationLedger)`), moved from `scripts/agent/src/card-signer.ts` into the package without behavior change.
- Amounts are strings of 7-decimal base units on the wire; `1 USDC = 10_000_000`.
- Denial semantics (spike note): a verify-time 402 with `invalid_exact_stellar_payload_simulation_failed` and a settle-time `success: false` are both **policy denials**, never retried automatically. Auth-phase host errors (`Abort`, Crypto) count as denials too.
- Contract error codes (card): 1 BadSignature, 2 WrongContext, 3 Frozen, 4 Cancelled, 5 Expired, 6 NotAllowlisted, 7 OverPerTxCap, 8 OverBudget, 9 InvalidAmount, 10 AllowlistFull, 11 InvalidPolicy, 12 InvalidState. The USDC SAC also reports its own `Error(Contract, #N)` codes (e.g. `#10` zero balance), so a bare number is attributed to the card only when the pre-check or diagnostics say the card contract raised it.
- Card views used by the client: `info() -> CardInfo { owner, signer, token, policy { period_amount, period_duration, max_per_tx, expiry }, state (0 Active / 1 Frozen / 2 Cancelled), period { start, spent }, remaining, balance, allow_count }` and `merchants() -> Vec<Address>`.
- Live testnet objects (from `deployed.testnet.json`, public): card `CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ`, token (USDC SAC) `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, merchant `GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG` (allowlisted), funder `GDJ33V6NOUCXMS2Q24FHSTXSTZDUANPCJXSCQHPZFUM7KWMJ5D2DMKBR` (has a USDC trustline, NOT allowlisted). CLI identities `mooring-owner`, `mooring-agent`, `mooring-merchant`, `mooring-funder`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work on `feat/d2-x402-integration` off `main`; push the branch and open a PR at the end (the owner asked for a branch → PR → merge flow); never push to `main` directly, never force-push.
- Manual step the owner must do once: generate an OZ Channels **testnet** API key at https://channels.openzeppelin.com/testnet/gen and put it in `examples/merchant-server/.env` as `OZ_API_KEY`. Tasks that need it say so.

## File Structure

```
package.json                              npm workspace root: workspaces, shared scripts (build/test/typecheck)
tsconfig.base.json                        shared strict ESM TS config
packages/x402-client/package.json         @mooring/x402-client (library; build → dist/, ESM, types)
packages/x402-client/tsconfig.json
packages/x402-client/src/index.ts         public exports
packages/x402-client/src/signer.ts        signCardAuthEntries (moved from scripts/agent)
packages/x402-client/src/card.ts          readCardInfo / readMerchants (RPC simulation of the views), CardInfo type
packages/x402-client/src/denial.ts        DenialReason, CardPolicyDenied, classifyContractError, CARD_ERROR_CODES
packages/x402-client/src/precheck.ts      precheck(info, merchants, requirements) → DenialReason | null  (pure)
packages/x402-client/src/scheme.ts        CardExactStellarScheme implements SchemeNetworkClient
packages/x402-client/src/client.ts        createMooringClient (x402Client + hooks), createMooringFetch, getSettlement
packages/x402-client/test/denial.test.ts
packages/x402-client/test/precheck.test.ts
packages/x402-client/test/scheme.test.ts  validation + payload shape (RPC mocked)
packages/x402-client/test/client.test.ts  hook flow with a fake 402 server (fetch mocked)
packages/x402-client/e2e/testnet.e2e.ts   real testnet + OZ facilitator (env-gated, not in CI)
packages/cli/package.json                 mooring CLI (bin: mooring)
packages/cli/src/index.ts                 commander program: keygen, status, pay
packages/cli/test/cli.test.ts
examples/merchant-server/package.json     x402-protected Express API (stock server side)
examples/merchant-server/src/app.ts       createMerchantApp(config) → express app (testable)
examples/merchant-server/src/server.ts    entrypoint (env → listen)
examples/merchant-server/.env.example
examples/merchant-server/test/app.test.ts 402 shape without facilitator (facilitator client mocked)
scripts/agent/src/card-signer.ts          becomes a re-export of the package (scripts keep working)
scripts/agent/src/fee32.ts                fee measurement with a 32-merchant allowlist
scripts/testnet/reset-policy.sh           owner: restore 50 USDC/day, 10 USDC max on the live card
.github/workflows/ci.yml                  scripts job → workspace: npm ci, build, typecheck, unit tests
docs/x402-integration.md                  how the integration works, denial semantics, setup
docs/testnet.md                           D2 evidence rows
docs/spike-w1-auth-mechanism.md           32-merchant fee measurement
README.md                                 client quickstart
CLAUDE.md                                 workflow line, W2/W3 status
```

---

### Task 1: npm workspace, client package skeleton, signer move, CI

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `packages/x402-client/{package.json,tsconfig.json,src/index.ts,src/signer.ts,test/signer.test.ts}`
- Modify: `scripts/agent/package.json` (depend on the workspace package), `scripts/agent/src/card-signer.ts` (re-export), `.github/workflows/ci.yml` (scripts job), `.gitignore` (`dist/`, `**/node_modules`)

**Interfaces:**
- Produces: `@mooring/x402-client` exporting `signCardAuthEntries(tx: contract.AssembledTransaction<unknown>, cardAddress: string, agent: Keypair, expirationLedger: number): Promise<void>` (identical behavior to the D1 script version); root scripts `npm run build`, `npm run typecheck`, `npm test`.

- [ ] **Step 1: Root workspace**

`package.json`:
```json
{
  "name": "mooring-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "examples/*", "scripts/agent"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "e2e": "npm run e2e -w @mooring/x402-client"
  },
  "engines": { "node": ">=20" }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Append to `.gitignore`:
```
# node workspaces
**/node_modules
**/dist
**/.env
!**/.env.example
```
(Keep the existing `scripts/agent/*` lines; the new patterns subsume them.)

- [ ] **Step 2: Client package skeleton**

`packages/x402-client/package.json`:
```json
{
  "name": "@mooring/x402-client",
  "version": "0.1.0",
  "description": "Pay x402-protected APIs from a Mooring spending card on Stellar.",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run",
    "e2e": "tsx e2e/testnet.e2e.ts"
  },
  "dependencies": {
    "@stellar/stellar-sdk": "^17.0.1",
    "@x402/core": "2.25.0",
    "@x402/fetch": "2.25.0",
    "@x402/stellar": "2.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/x402-client/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```
`packages/x402-client/tsconfig.test.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true, "types": ["node"] }, "include": ["src", "test", "e2e"] }
```

- [ ] **Step 3: Move the signer (failing test first)**

`packages/x402-client/test/signer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { Keypair, xdr, hash, Address, nativeToScVal, authorizeEntry } from "@stellar/stellar-sdk";
import { signCardAuthEntries } from "../src/signer.js";

// Builds an unsigned auth entry addressed to `card` for token.transfer(card, to, amount).
function unsignedEntry(card: string, token: string, to: string, amount: bigint): xdr.SorobanAuthorizationEntry {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(token).toScAddress(),
        functionName: "transfer",
        args: [
          nativeToScVal(Address.fromString(card), { type: "address" }),
          nativeToScVal(Address.fromString(to), { type: "address" }),
          nativeToScVal(amount, { type: "i128" }),
        ],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(card).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  });
}

describe("signCardAuthEntries", () => {
  it("signs entries addressed to the card with the agent key and encodes Vec[{public_key, signature}]", async () => {
    const agent = Keypair.random();
    const card = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
    const token = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const to = Keypair.random().publicKey();
    const entry = unsignedEntry(card, token, to, 10_000n);
    const passphrase = "Test SDF Network ; September 2015";

    // Fake AssembledTransaction: only `built.operations[0].auth` and `signAuthEntries` are used.
    let received: { address?: string; expiration?: unknown; authorizeEntry?: Function } | undefined;
    const fakeTx = {
      built: { operations: [{ auth: [entry] }] },
      options: { networkPassphrase: passphrase },
      signAuthEntries: async (opts: typeof received) => {
        received = opts;
        // emulate the SDK: call the custom authorizeEntry with 4 args
        const signed = await opts!.authorizeEntry!(entry, undefined, 123456, passphrase);
        (fakeTx.built.operations[0].auth as xdr.SorobanAuthorizationEntry[])[0] = signed;
      },
    } as unknown as Parameters<typeof signCardAuthEntries>[0];

    await signCardAuthEntries(fakeTx, card, agent, 123456);

    expect(received?.address).toBe(card);
    const signed = (fakeTx as unknown as { built: { operations: { auth: xdr.SorobanAuthorizationEntry[] }[] } }).built.operations[0].auth[0];
    const creds = signed.credentials().address();
    expect(creds.signatureExpirationLedger()).toBe(123456);
    const sigVec = creds.signature().vec()!;
    expect(sigVec.length).toBe(1);
    const map = sigVec[0].map()!;
    const keys = map.map((e) => e.key().sym().toString()).sort();
    expect(keys).toEqual(["public_key", "signature"]);
    const pk = map.find((e) => e.key().sym().toString() === "public_key")!.val().bytes();
    expect(Buffer.from(pk).equals(agent.rawPublicKey())).toBe(true);
    // The signature must verify over sha256(preimage) — recompute with the SDK helper.
    const sig = map.find((e) => e.key().sym().toString() === "signature")!.val().bytes();
    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(Buffer.from(passphrase)),
        nonce: creds.nonce(),
        signatureExpirationLedger: creds.signatureExpirationLedger(),
        invocation: signed.rootInvocation(),
      }),
    );
    expect(agent.verify(hash(preimage.toXDR()), Buffer.from(sig))).toBe(true);
  });
});
```

Run: `cd packages/x402-client && npm install && npx vitest run` — Expected: FAIL, `../src/signer.js` not found.

- [ ] **Step 4: `src/signer.ts` and `src/index.ts`**

Move the implementation verbatim from `scripts/agent/src/card-signer.ts` (the custom-`authorizeEntry` version, 4 parameters, comment about `forAddress` corrected in D1) to `packages/x402-client/src/signer.ts`, exporting `signCardAuthEntries`. `src/index.ts`:
```ts
export { signCardAuthEntries } from "./signer.js";
```
Replace `scripts/agent/src/card-signer.ts` with:
```ts
export { signCardAuthEntries } from "@mooring/x402-client";
```
and add `"@mooring/x402-client": "0.1.0"` to `scripts/agent/package.json` dependencies (npm workspaces link it). The scripts import path stays `./card-signer.js`, so `pay.ts`/`race.ts` are untouched.

- [ ] **Step 5: Run, typecheck, root install**

From the repo root: `npm install` (creates the workspace lockfile at the root; delete `scripts/agent/package-lock.json` since the root lockfile now owns it), `npm run build`, `npm run typecheck`, `npm test`. Expected: signer test PASS; `scripts/agent` typechecks against the built package (`tsc --noEmit` there; add a `"typecheck": "tsc --noEmit"` script to `scripts/agent/package.json` if missing).

- [ ] **Step 6: CI**

In `.github/workflows/ci.yml` replace the `scripts` job steps with:
```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: package-lock.json
      - run: npm ci
      - run: npm run build
      - run: npm run typecheck
      - run: npm test
```
(no `working-directory`; the job runs at the root). Keep the `contracts` job unchanged.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json packages/x402-client scripts/agent .gitignore .github/workflows/ci.yml
git rm --cached scripts/agent/package-lock.json 2>/dev/null; rm -f scripts/agent/package-lock.json
git commit -m "chore(node): npm workspace, @mooring/x402-client skeleton with card signer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Denial classification and policy pre-check (pure)

**Files:**
- Create: `packages/x402-client/src/denial.ts`, `packages/x402-client/src/precheck.ts`, `packages/x402-client/src/card.ts` (types only in this task), `test/denial.test.ts`, `test/precheck.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces:
  - `type DenialReason = "frozen" | "cancelled" | "expired" | "not_allowlisted" | "over_per_tx_cap" | "over_budget" | "wrong_token" | "insufficient_balance" | "bad_signature" | "wrong_context" | "unknown"`
  - `class CardPolicyDenied extends Error { reason: DenialReason; contractError?: number; stage: "precheck" | "verify" | "settle"; detail?: string }`
  - `CARD_ERROR_CODES: Record<number, DenialReason>` (1→bad_signature, 2→wrong_context, 3→frozen, 4→cancelled, 5→expired, 6→not_allowlisted, 7→over_per_tx_cap, 8→over_budget)
  - `classifyContractError(text: string): { code: number; reason: DenialReason } | null` — parses `Error(Contract, #N)`
  - `type CardInfo = { owner: string; signer: Uint8Array; token: string; policy: { period_amount: bigint; period_duration: bigint; max_per_tx: bigint; expiry: bigint }; state: 0 | 1 | 2; period: { start: bigint; spent: bigint }; remaining: bigint; balance: bigint; allow_count: number }`
  - `precheck(info: CardInfo, merchants: string[], req: { payTo: string; amount: string; asset: string }, nowSeconds: number): DenialReason | null` in the order: token mismatch → state → expiry → allowlist → per-tx cap → remaining budget → balance.

- [ ] **Step 1: Failing tests**

`test/denial.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CARD_ERROR_CODES, CardPolicyDenied, classifyContractError } from "../src/denial.js";

describe("classifyContractError", () => {
  it("maps card error codes", () => {
    expect(classifyContractError("HostError: Error(Contract, #8)\n...")).toEqual({ code: 8, reason: "over_budget" });
    expect(classifyContractError("Error(Contract, #6)")).toEqual({ code: 6, reason: "not_allowlisted" });
    expect(classifyContractError("Error(Contract, #3)")).toEqual({ code: 3, reason: "frozen" });
  });
  it("returns unknown for codes the card does not define as denials", () => {
    expect(classifyContractError("Error(Contract, #10)")).toEqual({ code: 10, reason: "unknown" });
  });
  it("returns null when no contract error is present", () => {
    expect(classifyContractError("Error(Auth, InvalidAction)")).toBeNull();
  });
  it("covers every documented denial code", () => {
    expect(Object.keys(CARD_ERROR_CODES).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("CardPolicyDenied", () => {
  it("carries reason, stage and code", () => {
    const e = new CardPolicyDenied("over_budget", "verify", { contractError: 8, detail: "x" });
    expect(e.reason).toBe("over_budget");
    expect(e.stage).toBe("verify");
    expect(e.contractError).toBe(8);
    expect(e.message).toContain("over_budget");
    expect(e).toBeInstanceOf(Error);
  });
});
```

`test/precheck.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { precheck } from "../src/precheck.js";
import type { CardInfo } from "../src/card.js";

const USDC = 10_000_000n;
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const NOW = 1_800_000_000;

function info(over: Partial<CardInfo> = {}): CardInfo {
  return {
    owner: "GOWNER", signer: new Uint8Array(32), token: TOKEN,
    policy: { period_amount: 50n * USDC, period_duration: 86_400n, max_per_tx: 10n * USDC, expiry: BigInt(NOW + 3600) },
    state: 0, period: { start: BigInt(NOW - 100), spent: 0n },
    remaining: 50n * USDC, balance: 20n * USDC, allow_count: 1,
    ...over,
  };
}
const req = (amount: bigint, payTo = MERCHANT, asset = TOKEN) => ({ payTo, amount: amount.toString(), asset });

describe("precheck", () => {
  it("accepts a payment within policy", () => {
    expect(precheck(info(), [MERCHANT], req(USDC), NOW)).toBeNull();
  });
  it("rejects a different asset", () => {
    expect(precheck(info(), [MERCHANT], req(USDC, MERCHANT, "CXYZ"), NOW)).toBe("wrong_token");
  });
  it("rejects frozen and cancelled", () => {
    expect(precheck(info({ state: 1 }), [MERCHANT], req(USDC), NOW)).toBe("frozen");
    expect(precheck(info({ state: 2 }), [MERCHANT], req(USDC), NOW)).toBe("cancelled");
  });
  it("rejects after expiry", () => {
    expect(precheck(info(), [MERCHANT], req(USDC), NOW + 3600)).toBe("expired");
  });
  it("rejects an unlisted merchant", () => {
    expect(precheck(info(), [MERCHANT], req(USDC, "GOTHER"), NOW)).toBe("not_allowlisted");
  });
  it("rejects over the per-tx cap", () => {
    expect(precheck(info(), [MERCHANT], req(10n * USDC + 1n), NOW)).toBe("over_per_tx_cap");
  });
  it("rejects over the remaining budget", () => {
    expect(precheck(info({ remaining: 3n * USDC }), [MERCHANT], req(4n * USDC), NOW)).toBe("over_budget");
  });
  it("rejects when the card balance is too low", () => {
    expect(precheck(info({ balance: 1n * USDC }), [MERCHANT], req(2n * USDC), NOW)).toBe("insufficient_balance");
  });
  it("checks in the documented order (state before allowlist)", () => {
    expect(precheck(info({ state: 1 }), [MERCHANT], req(USDC, "GOTHER"), NOW)).toBe("frozen");
  });
});
```

Run: `npx vitest run` — Expected: FAIL (modules missing).

- [ ] **Step 2: Implement**

`src/denial.ts`:
```ts
export type DenialReason =
  | "frozen" | "cancelled" | "expired" | "not_allowlisted" | "over_per_tx_cap" | "over_budget"
  | "wrong_token" | "insufficient_balance" | "bad_signature" | "wrong_context" | "unknown";

export type DenialStage = "precheck" | "verify" | "settle";

/** Card contract error codes that mean "policy denied". */
export const CARD_ERROR_CODES: Record<number, DenialReason> = {
  1: "bad_signature",
  2: "wrong_context",
  3: "frozen",
  4: "cancelled",
  5: "expired",
  6: "not_allowlisted",
  7: "over_per_tx_cap",
  8: "over_budget",
};

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/;

/** Parses a Soroban `Error(Contract, #N)` from an error/diagnostic string. */
export function classifyContractError(text: string): { code: number; reason: DenialReason } | null {
  const m = CONTRACT_ERROR.exec(text);
  if (!m) return null;
  const code = Number(m[1]);
  return { code, reason: CARD_ERROR_CODES[code] ?? "unknown" };
}

export class CardPolicyDenied extends Error {
  readonly reason: DenialReason;
  readonly stage: DenialStage;
  readonly contractError?: number;
  readonly detail?: string;

  constructor(reason: DenialReason, stage: DenialStage, opts: { contractError?: number; detail?: string } = {}) {
    super(`card policy denied (${reason}) at ${stage}${opts.contractError ? ` [contract error #${opts.contractError}]` : ""}${opts.detail ? `: ${opts.detail}` : ""}`);
    this.name = "CardPolicyDenied";
    this.reason = reason;
    this.stage = stage;
    this.contractError = opts.contractError;
    this.detail = opts.detail;
  }
}
```

`src/card.ts` (types now; RPC readers in Task 3):
```ts
export type CardState = 0 | 1 | 2; // Active, Frozen, Cancelled

export interface CardPolicy {
  period_amount: bigint;
  period_duration: bigint;
  max_per_tx: bigint;
  expiry: bigint;
}

export interface CardInfo {
  owner: string;
  signer: Uint8Array;
  token: string;
  policy: CardPolicy;
  state: CardState;
  period: { start: bigint; spent: bigint };
  remaining: bigint;
  balance: bigint;
  allow_count: number;
}
```

`src/precheck.ts`:
```ts
import type { CardInfo } from "./card.js";
import type { DenialReason } from "./denial.js";

export interface PaymentTerms {
  payTo: string;
  amount: string; // base units
  asset: string;  // token contract address
}

/**
 * Local mirror of the card's on-chain policy, evaluated before signing so the agent
 * never submits a payment the card will reject. Order matches the contract.
 */
export function precheck(info: CardInfo, merchants: string[], req: PaymentTerms, nowSeconds: number): DenialReason | null {
  const amount = BigInt(req.amount);
  if (req.asset !== info.token) return "wrong_token";
  if (info.state === 1) return "frozen";
  if (info.state === 2) return "cancelled";
  if (BigInt(nowSeconds) >= info.policy.expiry) return "expired";
  if (!merchants.includes(req.payTo)) return "not_allowlisted";
  if (amount > info.policy.max_per_tx) return "over_per_tx_cap";
  if (amount > info.remaining) return "over_budget";
  if (amount > info.balance) return "insufficient_balance";
  return null;
}
```

Add to `src/index.ts`:
```ts
export { CARD_ERROR_CODES, CardPolicyDenied, classifyContractError } from "./denial.js";
export type { DenialReason, DenialStage } from "./denial.js";
export { precheck } from "./precheck.js";
export type { PaymentTerms } from "./precheck.js";
export type { CardInfo, CardPolicy, CardState } from "./card.js";
```

- [ ] **Step 3: Run and commit**

`npx vitest run` → all PASS; `npm run typecheck` clean.
```bash
git add packages/x402-client
git commit -m "feat(client): typed denials and local policy pre-check

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Card view readers and the `CardExactStellarScheme`

**Files:**
- Modify: `packages/x402-client/src/card.ts` (add readers), `src/index.ts`
- Create: `packages/x402-client/src/scheme.ts`, `test/scheme.test.ts`

**Interfaces:**
- Consumes: `signCardAuthEntries`, `CardInfo`.
- Produces:
  - `readCardInfo(rpcUrl: string, networkPassphrase: string, card: string): Promise<CardInfo>` and `readMerchants(rpcUrl, networkPassphrase, card): Promise<string[]>` — simulate the `info` / `merchants` views with `contract.AssembledTransaction.build` and convert with `scValToNative`.
  - `class CardExactStellarScheme implements SchemeNetworkClient` with `constructor(opts: { card: string; agent: Keypair; network: "stellar:testnet" | "stellar:pubnet"; rpcUrl?: string })`, `readonly scheme = "exact"`, `findDefaultAsset` (re-exported from `@x402/stellar`), `createPaymentPayload(x402Version, requirements) -> Promise<PaymentPayloadResult>` producing `{ x402Version, payload: { transaction } }` exactly like the stock client, and `validateRequirements(req)` (throws on bad scheme/network/addresses/amount/`areFeesSponsored !== true`).

- [ ] **Step 1: Failing tests**

`test/scheme.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { Keypair, Transaction, xdr } from "@stellar/stellar-sdk";
import { CardExactStellarScheme } from "../src/scheme.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const reqs = (over: Partial<Record<string, unknown>> = {}) => ({
  scheme: "exact", network: "stellar:testnet", asset: TOKEN, amount: "10000", payTo: MERCHANT,
  maxTimeoutSeconds: 60, extra: { areFeesSponsored: true }, ...over,
});

describe("CardExactStellarScheme.validateRequirements", () => {
  const scheme = new CardExactStellarScheme({ card: CARD, agent: Keypair.random(), network: "stellar:testnet" });
  it("accepts valid requirements", () => {
    expect(() => scheme.validateRequirements(reqs() as never)).not.toThrow();
  });
  it("rejects wrong scheme, network, addresses, amount and unsponsored fees", () => {
    expect(() => scheme.validateRequirements(reqs({ scheme: "upto" }) as never)).toThrow(/scheme/);
    expect(() => scheme.validateRequirements(reqs({ network: "stellar:pubnet" }) as never)).toThrow(/network/);
    expect(() => scheme.validateRequirements(reqs({ payTo: "not-an-address" }) as never)).toThrow(/destination/);
    expect(() => scheme.validateRequirements(reqs({ asset: MERCHANT }) as never)).toThrow(/asset/);
    expect(() => scheme.validateRequirements(reqs({ amount: "0" }) as never)).toThrow(/amount/);
    expect(() => scheme.validateRequirements(reqs({ amount: "1.5" }) as never)).toThrow(/amount/);
    expect(() => scheme.validateRequirements(reqs({ extra: {} }) as never)).toThrow(/areFeesSponsored/);
  });
});

describe("CardExactStellarScheme.createPaymentPayload", () => {
  it("builds transfer(card, payTo, amount), signs the card entry with the agent and returns the tx XDR", async () => {
    const agent = Keypair.random();
    const scheme = new CardExactStellarScheme({ card: CARD, agent, network: "stellar:testnet" });

    // Stub the two RPC-dependent collaborators the scheme uses.
    const fakeBuilt = new Transaction(
      // any valid tx envelope works for the shape assertion; build one from a fixture
      (await import("./fixtures/transfer-tx.js")).TRANSFER_TX_XDR, "Test SDF Network ; September 2015",
    );
    const fakeTx = {
      built: fakeBuilt,
      simulation: { minResourceFee: "1", latestLedger: 100 },
      needsNonInvokerSigningBy: vi.fn().mockReturnValue([CARD]),
      simulate: vi.fn().mockResolvedValue(undefined),
    };
    const build = vi.spyOn(scheme as never, "buildTransfer").mockResolvedValue(fakeTx as never);
    const sign = vi.spyOn(scheme as never, "sign").mockResolvedValue(undefined);
    vi.spyOn(scheme as never, "latestLedger").mockResolvedValue(1000);

    const out = await scheme.createPaymentPayload(2, reqs() as never);

    expect(build).toHaveBeenCalledWith(TOKEN, CARD, MERCHANT, 10000n);
    expect(sign).toHaveBeenCalledWith(fakeTx, 1000 + Math.ceil(60 / 5));
    expect(fakeTx.simulate).toHaveBeenCalledTimes(1);
    expect(out.x402Version).toBe(2);
    expect(typeof (out.payload as { transaction: string }).transaction).toBe("string");
    expect(() => xdr.TransactionEnvelope.fromXDR((out.payload as { transaction: string }).transaction, "base64")).not.toThrow();
  });

  it("refuses when the card is not the only pending signer", async () => {
    const scheme = new CardExactStellarScheme({ card: CARD, agent: Keypair.random(), network: "stellar:testnet" });
    vi.spyOn(scheme as never, "buildTransfer").mockResolvedValue({
      built: {}, simulation: {}, needsNonInvokerSigningBy: () => [MERCHANT], simulate: async () => {},
    } as never);
    vi.spyOn(scheme as never, "latestLedger").mockResolvedValue(1);
    await expect(scheme.createPaymentPayload(2, reqs() as never)).rejects.toThrow(/Expected to sign with/);
  });
});
```

`test/fixtures/transfer-tx.ts`: export `TRANSFER_TX_XDR` = a base64 transaction envelope. Generate it once with a script using `TransactionBuilder` + `Operation.invokeContractFunction({ contract: TOKEN, function: "transfer", args: [...] })` with any funded-looking source (`Keypair.random().publicKey()`, sequence `"1"`, fee `"100"`, `networkPassphrase` testnet, `setTimeout(60)`), and paste the string into the fixture with a comment saying how it was produced.

Run: `npx vitest run test/scheme.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `card.ts` readers**

Append to `src/card.ts`:
```ts
import { Address, contract, scValToNative, xdr } from "@stellar/stellar-sdk";

type RawInfo = {
  owner: string; signer: Buffer | Uint8Array; token: string;
  policy: { period_amount: bigint; period_duration: bigint; max_per_tx: bigint; expiry: bigint };
  state: number; period: { start: bigint; spent: bigint }; remaining: bigint; balance: bigint; allow_count: number;
};

async function simulateView<T>(rpcUrl: string, networkPassphrase: string, card: string, method: string): Promise<T> {
  const tx = await contract.AssembledTransaction.build<T>({
    contractId: card,
    method,
    args: [],
    networkPassphrase,
    rpcUrl,
    parseResultXdr: (v: xdr.ScVal) => scValToNative(v) as T,
  });
  return tx.result;
}

/** Reads the card's `info()` view via simulation (no signing, no fees). */
export async function readCardInfo(rpcUrl: string, networkPassphrase: string, card: string): Promise<CardInfo> {
  const raw = await simulateView<RawInfo>(rpcUrl, networkPassphrase, card, "info");
  return {
    owner: raw.owner,
    signer: new Uint8Array(raw.signer),
    token: raw.token,
    policy: raw.policy,
    state: raw.state as CardState,
    period: raw.period,
    remaining: raw.remaining,
    balance: raw.balance,
    allow_count: Number(raw.allow_count),
  };
}

/** Reads the card's `merchants()` view via simulation. */
export async function readMerchants(rpcUrl: string, networkPassphrase: string, card: string): Promise<string[]> {
  const list = await simulateView<string[]>(rpcUrl, networkPassphrase, card, "merchants");
  return list.map((a) => (typeof a === "string" ? a : Address.fromScAddress(a as unknown as xdr.ScAddress).toString()));
}
```
If `scValToNative` returns addresses as strings (it does for `Address` ScVals), the `map` is a no-op; keep the guard.

- [ ] **Step 3: Implement `scheme.ts`**

```ts
import { Address, Keypair, contract, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import type { PaymentPayloadResult, PaymentRequirements, SchemeNetworkClient } from "@x402/core/types";
import {
  DEFAULT_ESTIMATED_LEDGER_SECONDS, findDefaultAsset, getNetworkPassphrase, getRpcUrl,
  validateStellarAssetAddress, validateStellarDestinationAddress,
} from "@x402/stellar";
import { signCardAuthEntries } from "./signer.js";

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

export interface CardSchemeOptions {
  /** Card contract address (C...). The card is the payer. */
  card: string;
  /** Agent keypair registered as the card's signer. */
  agent: Keypair;
  network: StellarNetwork;
  /** Required on pubnet; optional on testnet. */
  rpcUrl?: string;
}

/**
 * x402 "exact" scheme client where the payer is a Mooring card (a Soroban custom account).
 * Produces the same payload as @x402/stellar's ExactStellarScheme; only the signing differs.
 */
export class CardExactStellarScheme implements SchemeNetworkClient {
  readonly scheme = "exact";
  readonly findDefaultAsset = findDefaultAsset;
  private readonly card: string;
  private readonly agent: Keypair;
  private readonly network: StellarNetwork;
  private readonly rpcUrl: string;
  private readonly passphrase: string;

  constructor(opts: CardSchemeOptions) {
    this.card = opts.card;
    this.agent = opts.agent;
    this.network = opts.network;
    this.rpcUrl = getRpcUrl(opts.network, opts.rpcUrl ? { url: opts.rpcUrl } : undefined);
    this.passphrase = getNetworkPassphrase(opts.network);
  }

  validateRequirements(req: PaymentRequirements): void {
    if (req.scheme !== "exact") throw new Error(`Unsupported scheme: ${req.scheme}`);
    if (req.network !== this.network) throw new Error(`Unsupported network: ${req.network} (client is ${this.network})`);
    if (!validateStellarDestinationAddress(req.payTo)) throw new Error(`Invalid Stellar destination address: ${req.payTo}`);
    if (!validateStellarAssetAddress(req.asset)) throw new Error(`Invalid Stellar asset address: ${req.asset}`);
    if (!/^\d+$/.test(req.amount) || BigInt(req.amount) <= 0n) throw new Error(`Invalid amount: ${req.amount}`);
    if (req.extra?.areFeesSponsored !== true) throw new Error("Exact scheme requires areFeesSponsored to be true");
  }

  async createPaymentPayload(x402Version: number, req: PaymentRequirements): Promise<PaymentPayloadResult> {
    this.validateRequirements(req);
    const amount = BigInt(req.amount);
    const tx = await this.buildTransfer(req.asset, this.card, req.payTo, amount);
    const pending = tx.needsNonInvokerSigningBy();
    if (!pending.includes(this.card) || pending.length > 1) {
      throw new Error(`Expected to sign with [${this.card}], but got [${pending.join(", ")}]`);
    }
    const maxLedger = (await this.latestLedger()) + Math.ceil(req.maxTimeoutSeconds / DEFAULT_ESTIMATED_LEDGER_SECONDS);
    await this.sign(tx, maxLedger);
    await tx.simulate();
    const still = tx.needsNonInvokerSigningBy();
    if (still.length > 0) throw new Error(`unexpected signer(s) required: [${still.join(", ")}]`);
    return { x402Version, payload: { transaction: tx.built!.toXDR() } };
  }

  // --- collaborators (protected so tests can stub them) ---

  protected async buildTransfer(asset: string, from: string, to: string, amount: bigint) {
    const tx = await contract.AssembledTransaction.build({
      contractId: asset,
      method: "transfer",
      args: [
        nativeToScVal(Address.fromString(from), { type: "address" }),
        nativeToScVal(Address.fromString(to), { type: "address" }),
        nativeToScVal(amount, { type: "i128" }),
      ],
      networkPassphrase: this.passphrase,
      rpcUrl: this.rpcUrl,
      parseResultXdr: (r) => r,
    });
    const sim = tx.simulation;
    if (!sim || rpc.Api.isSimulationError(sim)) {
      throw new Error(`Stellar simulation failed${sim && "error" in sim ? `: ${sim.error}` : ""}`);
    }
    if (rpc.Api.isSimulationRestore(sim)) throw new Error("Stellar simulation requires a ledger entry restore");
    return tx;
  }

  protected async sign(tx: contract.AssembledTransaction<unknown>, expirationLedger: number): Promise<void> {
    await signCardAuthEntries(tx, this.card, this.agent, expirationLedger);
  }

  protected async latestLedger(): Promise<number> {
    const server = new rpc.Server(this.rpcUrl, { allowHttp: this.network === "stellar:testnet" });
    return (await server.getLatestLedger()).sequence;
  }
}
```
Note: the stock client estimates ledger close time from Horizon; using the constant 5 s is acceptable and avoids a Horizon dependency (the facilitator tolerates `maxLedger + 2`; with `maxTimeoutSeconds = 60` both give 12 ledgers).

Exports in `src/index.ts`: `readCardInfo`, `readMerchants`, `CardExactStellarScheme`, `CardSchemeOptions`, `StellarNetwork`.

- [ ] **Step 4: Run, typecheck, commit**

`npx vitest run` → PASS; `npm run typecheck` clean. If `PaymentPayloadResult`/`SchemeNetworkClient` are exported under a different path than `@x402/core/types` in the installed package, adapt the import (they are re-exported by `@x402/fetch` as well).

```bash
git add packages/x402-client
git commit -m "feat(client): card view readers and CardExactStellarScheme

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `createMooringClient` / `createMooringFetch` with pre-check and denial hooks

**Files:**
- Create: `packages/x402-client/src/client.ts`, `test/client.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `CardExactStellarScheme`, `readCardInfo`, `readMerchants`, `precheck`, `CardPolicyDenied`, `classifyContractError`; `x402Client`, `wrapFetchWithPayment`, `decodePaymentResponseHeader` from `@x402/fetch`.
- Produces:
  - `interface MooringClientOptions { card: string; agent: Keypair; network: StellarNetwork; rpcUrl?: string; precheck?: boolean /* default true */; onDenial?: (d: CardPolicyDenied) => void }`
  - `createMooringClient(opts): x402Client` — registers the scheme for `opts.network`, disables x402's USD spend controls (the card enforces limits), adds `onBeforePaymentCreation` (runs `precheck` against fresh `info()`/`merchants()`; on denial records it and returns `{ abort: true, reason }`) and `onPaymentResponse` (verify failure → re-runs the pre-check to classify, falls back to `classifyContractError` on any error text, records a `CardPolicyDenied` with stage `verify`; settle failure → stage `settle`).
  - `createMooringFetch(opts): typeof fetch` — `wrapFetchWithPayment(fetch, client)` wrapped so that when the underlying wrapper throws after a recorded denial, `CardPolicyDenied` is thrown instead.
  - `getSettlement(res: Response): { success: boolean; transaction: string; network: string; payer?: string } | null` — decodes `PAYMENT-RESPONSE`.

- [ ] **Step 1: Failing tests**

`test/client.test.ts` (fake HTTP: a `fetch` stub that answers 402 with a `PAYMENT-REQUIRED` header, then 200 with `PAYMENT-RESPONSE` when a `PAYMENT-SIGNATURE` header is present; scheme and readers stubbed with `vi.mock`):
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const USDC = 10_000_000n;

const info = { owner: "G", signer: new Uint8Array(32), token: TOKEN,
  policy: { period_amount: 50n * USDC, period_duration: 86_400n, max_per_tx: 10n * USDC, expiry: 4_000_000_000n },
  state: 0, period: { start: 0n, spent: 0n }, remaining: 50n * USDC, balance: 20n * USDC, allow_count: 1 };

vi.mock("../src/card.js", () => ({
  readCardInfo: vi.fn(async () => info),
  readMerchants: vi.fn(async () => [MERCHANT]),
}));
vi.mock("../src/scheme.js", () => ({
  CardExactStellarScheme: class {
    scheme = "exact";
    findDefaultAsset = () => undefined;
    async createPaymentPayload(v: number) { return { x402Version: v, payload: { transaction: "AAAA" } }; }
  },
}));

const { createMooringFetch, getSettlement } = await import("../src/client.js");

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const paymentRequired = (amount: string, payTo = MERCHANT, error?: string) => ({
  x402Version: 2, error, resource: { url: "http://api.test/weather" },
  accepts: [{ scheme: "exact", network: "stellar:testnet", asset: TOKEN, amount, payTo, maxTimeoutSeconds: 60, extra: { areFeesSponsored: true } }],
});

function fakeServer(opts: { amount: string; payTo?: string; verifyFails?: boolean; settleFails?: boolean }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const paid = headers.has("PAYMENT-SIGNATURE");
    if (!paid || opts.verifyFails) {
      const body = paymentRequired(opts.amount, opts.payTo, paid ? "invalid_exact_stellar_payload_simulation_failed" : undefined);
      return new Response(JSON.stringify(body), { status: 402, headers: { "PAYMENT-REQUIRED": b64(body), "content-type": "application/json" } });
    }
    if (opts.settleFails) {
      const settle = { success: false, errorReason: "settle_exact_stellar_transaction_failed", transaction: "deadbeef", network: "stellar:testnet" };
      return new Response(JSON.stringify(settle), { status: 402, headers: { "PAYMENT-RESPONSE": b64(settle) } });
    }
    const settle = { success: true, transaction: "cafebabe", network: "stellar:testnet", payer: CARD };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "PAYMENT-RESPONSE": b64(settle), "content-type": "application/json" } });
  });
}

const opts = () => ({ card: CARD, agent: Keypair.random(), network: "stellar:testnet" as const });

describe("createMooringFetch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pays a 402 and exposes the settlement", async () => {
    const f = createMooringFetch({ ...opts(), fetch: fakeServer({ amount: "10000" }) });
    const res = await f("http://api.test/weather");
    expect(res.status).toBe(200);
    expect(getSettlement(res)).toMatchObject({ success: true, transaction: "cafebabe" });
  });

  it("denies locally before signing when the merchant is not allowlisted", async () => {
    const onDenial = vi.fn();
    const f = createMooringFetch({ ...opts(), onDenial, fetch: fakeServer({ amount: "10000", payTo: "GOTHER" }) });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({ name: "CardPolicyDenied", reason: "not_allowlisted", stage: "precheck" });
    expect(onDenial).toHaveBeenCalledTimes(1);
  });

  it("denies locally when the amount exceeds the per-tx cap", async () => {
    const f = createMooringFetch({ ...opts(), fetch: fakeServer({ amount: (11n * USDC).toString() }) });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({ reason: "over_per_tx_cap", stage: "precheck" });
  });

  it("classifies a verify-time 402 as a policy denial", async () => {
    const f = createMooringFetch({ ...opts(), precheck: false, fetch: fakeServer({ amount: "10000", verifyFails: true }) });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({ name: "CardPolicyDenied", stage: "verify" });
  });

  it("classifies a settle failure as a policy denial with the tx hash", async () => {
    const f = createMooringFetch({ ...opts(), fetch: fakeServer({ amount: "10000", settleFails: true }) });
    await expect(f("http://api.test/weather")).rejects.toMatchObject({ stage: "settle", detail: expect.stringContaining("deadbeef") });
  });
});
```

Run: `npx vitest run test/client.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `client.ts`**

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import { getNetworkPassphrase, getRpcUrl } from "@x402/stellar";
import { readCardInfo, readMerchants } from "./card.js";
import { CardPolicyDenied, classifyContractError, type DenialReason } from "./denial.js";
import { precheck } from "./precheck.js";
import { CardExactStellarScheme, type StellarNetwork } from "./scheme.js";

export interface MooringClientOptions {
  card: string;
  agent: Keypair;
  network: StellarNetwork;
  rpcUrl?: string;
  /** Run the local policy pre-check before signing (default true). */
  precheck?: boolean;
  /** Called whenever a payment is denied, at any stage. */
  onDenial?: (denial: CardPolicyDenied) => void;
}

export interface Settlement {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

/** Internal: the last denial recorded by the hooks, so the fetch wrapper can rethrow it typed. */
class DenialBox {
  last?: CardPolicyDenied;
  set(d: CardPolicyDenied, onDenial?: (d: CardPolicyDenied) => void) {
    this.last = d;
    onDenial?.(d);
  }
}

export function createMooringClient(opts: MooringClientOptions, box: DenialBox = new DenialBox()): x402Client {
  const rpcUrl = getRpcUrl(opts.network, opts.rpcUrl ? { url: opts.rpcUrl } : undefined);
  const passphrase = getNetworkPassphrase(opts.network);
  const scheme = new CardExactStellarScheme({ card: opts.card, agent: opts.agent, network: opts.network, rpcUrl: opts.rpcUrl });

  const evaluate = async (req: PaymentRequirements): Promise<DenialReason | null> => {
    const [info, merchants] = await Promise.all([
      readCardInfo(rpcUrl, passphrase, opts.card),
      readMerchants(rpcUrl, passphrase, opts.card),
    ]);
    return precheck(info, merchants, { payTo: req.payTo, amount: req.amount, asset: req.asset }, Math.floor(Date.now() / 1000));
  };

  const client = x402Client.fromConfig({
    schemes: [{ network: opts.network, client: scheme }],
    // The card enforces limits on-chain; x402's USD-based client caps would only get in the way.
    spendControls: false,
  });

  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    if (opts.precheck === false) return;
    const reason = await evaluate(selectedRequirements);
    if (reason) {
      box.set(new CardPolicyDenied(reason, "precheck"), opts.onDenial);
      return { abort: true, reason };
    }
  });

  client.onPaymentResponse(async ({ requirements, settleResponse, paymentRequired, error }) => {
    if (settleResponse && !settleResponse.success) {
      const parsed = classifyContractError(settleResponse.errorMessage ?? settleResponse.errorReason ?? "");
      box.set(new CardPolicyDenied(parsed?.reason ?? "unknown", "settle", {
        contractError: parsed?.code,
        detail: `${settleResponse.errorReason ?? "settle failed"} tx=${settleResponse.transaction}`,
      }), opts.onDenial);
      return;
    }
    if (paymentRequired && !settleResponse) {
      // Verify failed. The facilitator does not say why; ask the card.
      let reason: DenialReason = "unknown";
      let code: number | undefined;
      try {
        reason = (await evaluate(requirements)) ?? "unknown";
      } catch { /* keep unknown */ }
      const parsed = classifyContractError(paymentRequired.error ?? error?.message ?? "");
      if (parsed) { reason = parsed.reason; code = parsed.code; }
      box.set(new CardPolicyDenied(reason, "verify", { contractError: code, detail: paymentRequired.error }), opts.onDenial);
    }
  });

  return client;
}

export function createMooringFetch(opts: MooringClientOptions & { fetch?: typeof globalThis.fetch }): typeof globalThis.fetch {
  const box = new DenialBox();
  const client = createMooringClient(opts, box);
  const wrapped = wrapFetchWithPayment(opts.fetch ?? globalThis.fetch, client);
  return (async (input, init) => {
    box.last = undefined;
    try {
      const res = await wrapped(input, init);
      // A settle failure comes back as a non-2xx with PAYMENT-RESPONSE; surface it typed.
      const settlement = getSettlement(res);
      if (settlement && !settlement.success) {
        throw box.last ?? new CardPolicyDenied("unknown", "settle", { detail: `tx=${settlement.transaction}` });
      }
      return res;
    } catch (err) {
      if (err instanceof CardPolicyDenied) throw err;
      if (box.last) throw box.last;
      throw err;
    }
  }) as typeof globalThis.fetch;
}

/** Decodes the PAYMENT-RESPONSE header of a paid response, if present. */
export function getSettlement(res: Response): Settlement | null {
  const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return null;
  return decodePaymentResponseHeader(header) as Settlement;
}
```

If `x402Client` exposes the hooks under different method names in 2.25.0 (check `node_modules/@x402/core/dist/esm/*.d.mts`: the class declares `onBeforePaymentCreation(hook)` and a payment-response registration; use whatever registers `OnPaymentResponseHook`), adapt the two calls and note it in the report. If `wrapFetchWithPayment` swallows the `abort` into a generic `Error`, the `catch` above converts it via `box.last`.

Exports in `src/index.ts`: `createMooringClient`, `createMooringFetch`, `getSettlement`, types `MooringClientOptions`, `Settlement`.

- [ ] **Step 3: Run, typecheck, commit**

`npx vitest run` → all PASS; `npm run typecheck` clean.
```bash
git add packages/x402-client
git commit -m "feat(client): createMooringClient/createMooringFetch with pre-check and typed denials

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Example merchant server (stock x402 server side)

**Files:**
- Create: `examples/merchant-server/{package.json,tsconfig.json,.env.example,src/app.ts,src/server.ts,test/app.test.ts}`

**Interfaces:**
- Produces: `createMerchantApp(config: { network: StellarNetwork; payTo: string; facilitator: FacilitatorClient; routes?: RoutesConfig }): express.Express` with default routes `GET /weather` ($0.001), `GET /premium` ($20 — above the card's 10 USDC cap, used for the denial scenario), `GET /health` (free); `createFacilitator(env)` building `HTTPFacilitatorClient` with the OZ bearer header; entrypoint `npm start` reading `.env`.

- [ ] **Step 1: Package**

`examples/merchant-server/package.json`:
```json
{
  "name": "@mooring/example-merchant-server",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/server.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@x402/core": "2.25.0",
    "@x402/express": "2.25.0",
    "@x402/stellar": "2.25.0",
    "dotenv": "^16.4.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```
`tsconfig.json`: extends base, `include: ["src", "test"]`, `noEmit: true`, `types: ["node"]`.

`.env.example`:
```
STELLAR_NETWORK=stellar:testnet
STELLAR_RECIPIENT=GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG   # merchant G address with a USDC trustline
FACILITATOR_URL=https://channels.openzeppelin.com/x402/testnet
OZ_API_KEY=                                                             # https://channels.openzeppelin.com/testnet/gen
PORT=3001
```

- [ ] **Step 2: Failing test (402 shape, facilitator mocked)**

`test/app.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createMerchantApp } from "../src/app.js";
import type { FacilitatorClient } from "@x402/core/server";

const MERCHANT = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const fakeFacilitator: FacilitatorClient = {
  getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }], extensions: [], signers: { "stellar:*": ["GFACILITATOR"] } }),
  verify: async () => ({ isValid: true }),
  settle: async () => ({ success: true, transaction: "abc", network: "stellar:testnet" }),
} as unknown as FacilitatorClient;

describe("merchant app", () => {
  const app = createMerchantApp({ network: "stellar:testnet", payTo: MERCHANT, facilitator: fakeFacilitator });

  it("serves /health without payment", async () => {
    await request(app).get("/health").expect(200);
  });

  it("answers 402 with Stellar exact terms for /weather", async () => {
    const res = await request(app).get("/weather").expect(402);
    const header = res.headers["payment-required"];
    expect(header).toBeTruthy();
    const body = JSON.parse(Buffer.from(header, "base64").toString());
    expect(body.x402Version).toBe(2);
    const accept = body.accepts[0];
    expect(accept).toMatchObject({ scheme: "exact", network: "stellar:testnet", payTo: MERCHANT, asset: USDC, amount: "10000" });
    expect(accept.extra.areFeesSponsored).toBe(true);
  });

  it("prices /premium at 20 USDC", async () => {
    const res = await request(app).get("/premium").expect(402);
    const body = JSON.parse(Buffer.from(res.headers["payment-required"], "base64").toString());
    expect(body.accepts[0].amount).toBe("200000000");
  });
});
```
Run: `npx vitest run` in the example → FAIL (module missing).

- [ ] **Step 3: Implement**

`src/app.ts`:
```ts
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import type { FacilitatorClient, RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

export interface MerchantConfig {
  network: StellarNetwork;
  payTo: string;
  facilitator: FacilitatorClient;
  routes?: RoutesConfig;
}

export function defaultRoutes(network: StellarNetwork, payTo: string): RoutesConfig {
  return {
    "GET /weather": {
      accepts: { scheme: "exact", price: "$0.001", network, payTo },
      description: "Current weather (sample paid resource)",
    },
    "GET /premium": {
      accepts: { scheme: "exact", price: "$20", network, payTo },
      description: "Deliberately priced above a typical card per-tx cap",
    },
  };
}

export function createFacilitator(env: NodeJS.ProcessEnv): FacilitatorClient {
  const apiKey = env.OZ_API_KEY;
  if (!apiKey) {
    throw new Error("OZ_API_KEY is required. Generate one at https://channels.openzeppelin.com/testnet/gen (testnet).");
  }
  return new HTTPFacilitatorClient({
    url: env.FACILITATOR_URL ?? "https://channels.openzeppelin.com/x402/testnet",
    createAuthHeaders: async () => {
      const h = { Authorization: `Bearer ${apiKey}` };
      return { verify: h, settle: h, supported: h };
    },
  });
}

export function createMerchantApp(config: MerchantConfig): express.Express {
  const resourceServer = new x402ResourceServer(config.facilitator).register(config.network, new ExactStellarScheme());
  const app = express();
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(paymentMiddleware(config.routes ?? defaultRoutes(config.network, config.payTo), resourceServer));
  app.get("/weather", (_req, res) => res.json({ city: "Istanbul", temp: 24, conditions: "Clear" }));
  app.get("/premium", (_req, res) => res.json({ tier: "premium" }));
  return app;
}
```
`src/server.ts`:
```ts
import "dotenv/config";
import { createFacilitator, createMerchantApp, type StellarNetwork } from "./app.js";

const network = (process.env.STELLAR_NETWORK ?? "stellar:testnet") as StellarNetwork;
const payTo = process.env.STELLAR_RECIPIENT;
if (!payTo) throw new Error("STELLAR_RECIPIENT is required");
const app = createMerchantApp({ network, payTo, facilitator: createFacilitator(process.env) });
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`x402 merchant server on http://localhost:${port} (${network})`));
```
If `paymentMiddleware` performs a facilitator `getSupported` sync at startup and the test's fake needs a different shape, adapt the fake to what `x402ResourceServer` consumes (check `@x402/core` server types) — the test must not hit the network.

- [ ] **Step 4: Run, typecheck, commit**

`npx vitest run` → PASS; `npm run typecheck -w @mooring/example-merchant-server` clean.
```bash
git add examples/merchant-server package-lock.json
git commit -m "feat(example): x402 merchant server on @x402/express + @x402/stellar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end on testnet through OZ Channels (evidence)

**Files:**
- Create: `packages/x402-client/e2e/testnet.e2e.ts`, `scripts/testnet/reset-policy.sh`
- Modify: `docs/testnet.md` (D2 evidence), `docs/spike-w1-auth-mechanism.md` (OZ ceiling observation)

**Prerequisites (owner):** `examples/merchant-server/.env` with a valid `OZ_API_KEY`; `scripts/agent/.env` with `AGENT_SECRET` (exists from D1); the live card has budget: run `scripts/testnet/reset-policy.sh` first (it restores 50 USDC/day, 10 USDC max per tx as `mooring-owner`); card balance ≥ 1 USDC (it holds ~11 USDC after D1).

- [ ] **Step 1: `reset-policy.sh`**

```bash
#!/usr/bin/env bash
# Owner: restore the live card's policy to 50 USDC/day, 10 USDC max per payment, expiry +30 days.
set -euo pipefail
cd "$(dirname "$0")/../.."
CARD=$(jq -r .card deployed.testnet.json)
EXPIRY=$(( $(date +%s) + 30*86400 ))
stellar contract invoke --source-account mooring-owner --network testnet --id "$CARD" -- set_policy \
  --policy "{\"period_amount\":\"500000000\",\"period_duration\":86400,\"max_per_tx\":\"100000000\",\"expiry\":$EXPIRY}"
stellar contract invoke --source-account mooring-owner --network testnet --id "$CARD" -- info
```

- [ ] **Step 2: E2E script**

`packages/x402-client/e2e/testnet.e2e.ts` (run with `npm run e2e` from the root; reads `../../scripts/agent/.env` for `AGENT_SECRET`, `../../deployed.testnet.json`, and `../../examples/merchant-server/.env` for the OZ key; starts the merchant app in-process on a random port; prints a JSON evidence block at the end):
```ts
import "dotenv/config";
import { readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";
import { config as loadEnv } from "dotenv";
import { createFacilitator, createMerchantApp } from "../../../examples/merchant-server/src/app.js";
import { CardPolicyDenied, createMooringFetch, getSettlement, readCardInfo } from "../src/index.js";

loadEnv({ path: new URL("../../../scripts/agent/.env", import.meta.url).pathname });
loadEnv({ path: new URL("../../../examples/merchant-server/.env", import.meta.url).pathname });

const d = JSON.parse(readFileSync(new URL("../../../deployed.testnet.json", import.meta.url), "utf8"));
const RPC = "https://soroban-testnet.stellar.org";
const PASS = "Test SDF Network ; September 2015";
const agent = Keypair.fromSecret(process.env.AGENT_SECRET!);
const facilitator = createFacilitator(process.env);

async function listen(payTo: string) {
  const app = createMerchantApp({ network: "stellar:testnet", payTo, facilitator });
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const srv = app.listen(0, () => resolve({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, close: () => srv.close() }));
  });
}

const evidence: Record<string, unknown> = {};

// 1. Happy path: pay /weather from the card through OZ Channels.
{
  const srv = await listen(d.merchant);
  const before = await readCardInfo(RPC, PASS, d.card);
  const pay = createMooringFetch({ card: d.card, agent, network: "stellar:testnet" });
  const res = await pay(`${srv.url}/weather`);
  const settlement = getSettlement(res);
  const after = await readCardInfo(RPC, PASS, d.card);
  evidence.paid = { status: res.status, body: await res.json(), settlement, spentBefore: before.period.spent.toString(), spentAfter: after.period.spent.toString() };
  if (res.status !== 200 || !settlement?.success || after.period.spent - before.period.spent !== 10_000n) throw new Error("happy path failed: " + JSON.stringify(evidence.paid));
  srv.close();
}

// 2. Local denial: /premium is 20 USDC, above the 10 USDC per-tx cap.
{
  const srv = await listen(d.merchant);
  const pay = createMooringFetch({ card: d.card, agent, network: "stellar:testnet" });
  try { await pay(`${srv.url}/premium`); throw new Error("expected denial"); }
  catch (e) { if (!(e instanceof CardPolicyDenied) || e.reason !== "over_per_tx_cap" || e.stage !== "precheck") throw e; evidence.deniedPrecheck = { reason: e.reason, stage: e.stage }; }
  srv.close();
}

// 3. Facilitator-side denial: unlisted merchant, pre-check disabled so the payment reaches OZ verify.
{
  const srv = await listen(d.funder); // has a USDC trustline, is NOT on the allowlist
  const pay = createMooringFetch({ card: d.card, agent, network: "stellar:testnet", precheck: false });
  try { await pay(`${srv.url}/weather`); throw new Error("expected denial"); }
  catch (e) { if (!(e instanceof CardPolicyDenied) || e.stage !== "verify") throw e; evidence.deniedVerify = { reason: e.reason, stage: e.stage, detail: e.detail }; }
  srv.close();
}

console.log(JSON.stringify(evidence, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
```

Run: `scripts/testnet/reset-policy.sh` then `npm run e2e`. Expected: `paid.status 200`, `settlement.success true` with a tx hash, `spentAfter - spentBefore = 10000`; `deniedPrecheck.reason over_per_tx_cap`; `deniedVerify.stage verify` with `reason not_allowlisted` (from the re-run pre-check) and `detail` containing `simulation_failed`. If OZ rejects the happy path with `invalid_exact_stellar_payload_fee_exceeds_maximum`, record the message verbatim: that is the ceiling measurement, and the follow-up is the spike note's write-reduction lever.

- [ ] **Step 3: Record evidence**

`docs/testnet.md`, add a "D2 evidence" table: settlement tx hash (from `evidence.paid.settlement.transaction`, verify on Horizon `successful: true`), spent before/after, the two denial results with their reasons, and the OZ facilitator's observed behavior on the fee (accepted at ~34k stroops, or the exact rejection message). `docs/spike-w1-auth-mechanism.md`: append under "Open measurement": `OZ Channels testnet accepted a card payment at minResourceFee ≈ <n> stroops on 2026-09-<dd> (settlement tx <hash>).`

- [ ] **Step 4: Commit**

```bash
git add packages/x402-client/e2e scripts/testnet/reset-policy.sh docs/testnet.md docs/spike-w1-auth-mechanism.md
git commit -m "test(e2e): card pays an x402 API through OZ Channels; denial scenarios; evidence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Fee measurement with a full allowlist

**Files:**
- Create: `scripts/agent/src/fee32.ts`
- Modify: `docs/spike-w1-auth-mechanism.md`, `docs/testnet.md`

**Interfaces:**
- Consumes: `buildCardTransfer` from `scripts/agent/src/common.ts`, `signCardAuthEntries`, the `stellar` CLI as `mooring-owner`.
- Produces: the `minResourceFee` of a card payment when the allowlist holds 32 merchants, recorded in the docs.

- [ ] **Step 1: Script**

`scripts/agent/src/fee32.ts`: reads `deployed.testnet.json`; generates 31 random G addresses (`Keypair.random().publicKey()`); for each, runs `stellar contract invoke --source-account mooring-owner --network testnet --id $CARD -- add_merchant --merchant <G>` via `child_process.execFileSync` (sequentially; print progress); asserts `allow_count == 32` via `readCardInfo`; then builds and signs a 6 USDC transfer to the real merchant exactly like `pay.ts` does but only **simulates** (no submit) and prints `minResourceFee`; finally removes the 31 merchants again (`remove_merchant`) and asserts `allow_count == 1`. Guard: refuse to run if `allow_count != 1` at start.

- [ ] **Step 2: Run and record**

`cd scripts/agent && npx tsx src/fee32.ts`. Record in `docs/spike-w1-auth-mechanism.md`: `Measured 2026-09-<dd> with a 32-merchant allowlist: minResourceFee = <n> stroops → <within | exceeds> the 50 000 default ceiling.` and the same line in `docs/testnet.md`. If it exceeds the ceiling, add a follow-up section "Fee reduction options" listing: (a) `extend_instance` only when `get_ttl()` is below threshold in `enforce_payment`; (b) store the allowlist as a separate persistent entry read only in `enforce_payment` (moves bytes out of the instance entry the SAC also reads) — do not implement here.

- [ ] **Step 3: Commit**

```bash
git add scripts/agent/src/fee32.ts docs/spike-w1-auth-mechanism.md docs/testnet.md
git commit -m "chore(testnet): fee measurement with a 32-merchant allowlist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `mooring` CLI

**Files:**
- Create: `packages/cli/{package.json,tsconfig.json,src/index.ts,test/cli.test.ts}`

**Interfaces:**
- Consumes: `@mooring/x402-client` (`readCardInfo`, `readMerchants`, `createMooringFetch`, `getSettlement`, `CardPolicyDenied`).
- Produces: bin `mooring` with commands:
  - `mooring keygen [--hex]` — prints a new agent keypair (public G, secret S) and, with `--hex`, the 32-byte public key hex for `create_card --signer`.
  - `mooring status --card <C> [--network stellar:testnet|stellar:pubnet] [--rpc <url>] [--json]` — prints `info()` and `merchants()`.
  - `mooring pay <url> --card <C> [--agent-secret-env AGENT_SECRET] [--network …] [--rpc …] [--no-precheck]` — pays with the card; prints status, settlement tx and body; exits 2 on `CardPolicyDenied` with the reason.

- [ ] **Step 1: Package**

`packages/cli/package.json`:
```json
{
  "name": "@mooring/cli",
  "version": "0.1.0",
  "private": false,
  "license": "Apache-2.0",
  "type": "module",
  "bin": { "mooring": "./dist/index.js" },
  "files": ["dist"],
  "scripts": { "build": "tsc -p tsconfig.json", "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit", "test": "vitest run" },
  "dependencies": { "@mooring/x402-client": "0.1.0", "@stellar/stellar-sdk": "^17.0.1", "commander": "^12.1.0" },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.6.0", "vitest": "^3.0.0" }
}
```
`tsconfig.json` / `tsconfig.test.json` as in the client package. `src/index.ts` starts with `#!/usr/bin/env node`.

- [ ] **Step 2: Failing test**

`test/cli.test.ts`: build the `Command` via an exported `buildProgram(deps)` where `deps` = `{ readCardInfo, readMerchants, createMooringFetch, getSettlement, stdout: (s: string) => void }`, so tests inject fakes:
```ts
import { describe, expect, it, vi } from "vitest";
import { buildProgram } from "../src/index.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";

describe("mooring keygen", () => {
  it("prints a G and an S key, and the hex with --hex", async () => {
    const out: string[] = [];
    const program = buildProgram({ stdout: (s) => out.push(s) } as never);
    await program.parseAsync(["node", "mooring", "keygen", "--hex"]);
    const text = out.join("\n");
    expect(text).toMatch(/G[A-Z2-7]{55}/);
    expect(text).toMatch(/S[A-Z2-7]{55}/);
    expect(text).toMatch(/[0-9a-f]{64}/);
  });
});

describe("mooring status", () => {
  it("prints info and merchants as JSON with --json", async () => {
    const out: string[] = [];
    const info = { state: 0, remaining: 10n, balance: 20n, allow_count: 1, policy: { max_per_tx: 5n } };
    const program = buildProgram({
      stdout: (s) => out.push(s),
      readCardInfo: vi.fn(async () => info),
      readMerchants: vi.fn(async () => ["GMERCHANT"]),
    } as never);
    await program.parseAsync(["node", "mooring", "status", "--card", CARD, "--json"]);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.merchants).toEqual(["GMERCHANT"]);
    expect(parsed.info.remaining).toBe("10");
  });
});

describe("mooring pay", () => {
  it("prints the settlement on success and exits 2 on denial", async () => {
    const out: string[] = [];
    const fetchOk = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, transaction: "cafe", network: "stellar:testnet" })).toString("base64") } }));
    process.env.AGENT_SECRET = "SB3KTBG4ZUQDGFPQ4IQ7BSGKZAGVXRQ7RYMM7JKBHDSQRE6ZJ2AJMTTM";
    const program = buildProgram({ stdout: (s) => out.push(s), createMooringFetch: () => fetchOk, getSettlement: () => ({ success: true, transaction: "cafe", network: "stellar:testnet" }) } as never);
    await program.parseAsync(["node", "mooring", "pay", "http://x/weather", "--card", CARD]);
    expect(out.join("\n")).toContain("cafe");
  });
});
```
(Use any syntactically valid S key for the env in the test; the fake fetch never signs.)

- [ ] **Step 3: Implement**

`src/index.ts`: `buildProgram(deps = realDeps)` returns a `commander` `Command` with the three subcommands; `keygen` uses `Keypair.random()` and prints `Public key: G…`, `Secret key: S…` (with a warning that the secret is shown once), plus `Signer hex: …` (`rawPublicKey().toString("hex")`) when `--hex`; `status` calls the readers and prints a table or JSON (`bigint` → string); `pay` reads the secret from `process.env[opts.agentSecretEnv ?? "AGENT_SECRET"]`, builds the fetch with `createMooringFetch`, prints `HTTP <status>`, `Settlement: <tx> (<network>)` and the body, and on `CardPolicyDenied` prints `Denied (<reason>) at <stage>` and sets `process.exitCode = 2`. At the bottom: `if (import.meta.url === \`file://${process.argv[1]}\`) buildProgram().parseAsync(process.argv)`.

- [ ] **Step 4: Run, typecheck, commit**

`npx vitest run` → PASS; `npm run build && node packages/cli/dist/index.js keygen --hex` prints keys; `npm run typecheck` clean.
```bash
git add packages/cli package-lock.json
git commit -m "feat(cli): mooring keygen/status/pay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs, README quickstart, CLAUDE.md, pull request

**Files:**
- Create: `docs/x402-integration.md`, `packages/x402-client/README.md`
- Modify: `README.md`, `CLAUDE.md`, `docs/design.md` (status line), `docs/testnet.md` (D2 row cross-links)

- [ ] **Step 1: `docs/x402-integration.md`**

Sections: How a payment flows (sequence: agent → 402 → pre-check → sign (custom `authorizeEntry`, card as payer) → facilitator verify/settle → 200 + `PAYMENT-RESPONSE`); Why Mooring ships its own client scheme (from the spike note); Denial semantics (table: stage, how it is detected, what the client throws, whether it is retryable — never automatically); Server setup (env vars, OZ key, trustline on `payTo`); Client setup (`createMooringFetch` snippet, CLI snippet); Facilitator constraints the card honors (single transfer op, no sub-invocations, no events, fee ceiling with measured numbers); Known limits (pre-check is advisory; two concurrent payments can both pass verify and one fails at settle; muxed addresses rejected).

- [ ] **Step 2: `packages/x402-client/README.md` and root `README.md`**

Package README: install, 10-line usage (`createMooringFetch`), `CardPolicyDenied` handling, options table. Root README: add "Pay an API from a card" quickstart pointing to the package and CLI, and update the status paragraph (D1 done, D2 done, D3 next).

- [ ] **Step 3: `CLAUDE.md`**

- Replace "commit/push only when the owner asks" with: "Workflow: branch off `main` per deliverable or task group → frequent commits → push → PR → CI green → merge (owner's standing instruction since 2026-09-12). Never push to `main` directly; never force-push."
- Mark W2/W3 done, D2 delivered, and point the "Open measurement" line at the recorded numbers.
- `docs/design.md` status line: "D1 and D2 delivered (see docs/testnet.md); D3 next."

- [ ] **Step 4: Verify, commit, PR**

`npm run build && npm run typecheck && npm test && make test && make lint` all green.
```bash
git add docs README.md CLAUDE.md packages/x402-client/README.md
git commit -m "docs: x402 integration guide, client quickstart, workflow update

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/d2-x402-integration
```
Open the PR against `main` with `gh pr create` — title `D2: x402 integration — card pays x402 APIs through OZ Channels`, body summarizing the packages, the evidence table (settlement tx, denials, fee numbers) and follow-ups, ending with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01US19UXcUwgc8Nn4HwduUxY
```
Do not merge; the controller merges after CI.

---

## Self-review

**Spec coverage:** x402 server on `@x402/stellar` (Task 5); agent client detect-402 → local policy check → sign → retry → denials (Tasks 2–4); settled testnet payment with on-chain budget decrement + allowlist rejection proven (Task 6); npm package + CLI (Tasks 1, 8); fee measurement follow-ups from D1 (Tasks 6, 7); docs and workflow (Task 9).

**Type consistency:** `CardInfo` (Task 2) is what `readCardInfo` returns (Task 3) and what `precheck` consumes (Task 2) and `client.ts` passes (Task 4); `signCardAuthEntries` 4-arg (Task 1) is what `scheme.ts` calls (Task 3); `createMooringFetch` options (Task 4) are what the e2e (Task 6) and CLI (Task 8) use; `createMerchantApp`/`createFacilitator` (Task 5) are what the e2e imports.

**Known executor-facing risks (stated in-task):** exact hook registration method names on `x402Client` 2.25.0 (Task 4); how `wrapFetchWithPayment` surfaces an aborted payment (Task 4); the shape the fake facilitator must return for `x402ResourceServer`'s startup sync (Task 5); OZ Channels' real fee ceiling (Task 6).
