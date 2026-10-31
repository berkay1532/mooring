# Merchant Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner allow a merchant by pasting the x402 service URL (wizard and card screen), and let an agent's `not_allowlisted` denial link straight to that approval screen.

**Architecture:** A Next.js route handler (`/api/resolve-merchant`) fetches the service server-side behind an SSRF guard, normalises the 402 terms (v2 header or v1 body) and picks the entry matching the deployment's network + USDC. A shared `MerchantResolver` client component drives idle → resolving → resolved | failed on both screens and hands the resolved `payTo` to the existing `add_merchant` paths. Resolved names live per device in `lib/prefs`. The client package (`0.2.0`) attaches `merchant` + an `/allow` link to `CardPolicyDenied`, and a new `/allow` page consumes it.

**Tech Stack:** Next 15.5 App Router (Node runtime route handler), React 19, TypeScript, vitest (jsdom; `// @vitest-environment node` for the route), Playwright with the mock wallet and route stubs, `@x402/core/http` (`decodePaymentRequiredHeader`), `@stellar/stellar-sdk` `StrKey`.

**Spec:** `docs/superpowers/specs/2026-10-31-merchant-resolution-design.md`

## Global Constraints

- Network/asset match uses `config.network` and `config.usdc` from `apps/web/lib/config.ts`; every `NEXT_PUBLIC_*` read stays a literal `process.env.NEXT_PUBLIC_…` expression.
- Loopback/private hosts and `http:` are allowed only when the **server-side** env `MOORING_RESOLVER_ALLOW_LOCAL=1` is set. Never on Vercel.
- Resolver: GET first, one POST `{}` retry when the status is not 402; max 3 redirect hops, each re-validated; 5 s timeout; body read only on a 402 with no `PAYMENT-REQUIRED` header, capped at 64 KiB; `User-Agent: mooring-resolver/<web version>`; `Cache-Control: no-store`; 30 requests / minute / IP → HTTP 429.
- Service strings are untrusted: name ≤ 64 chars, description ≤ 280 chars, `iconUrl` only if `https:`; always rendered as text.
- Error codes: `invalid_url | blocked_url | unreachable | not_x402 | no_match | ambiguous`; `message` is one sentence; `blocked_url` never echoes the host.
- Responsibility notice (exact copy, resolved state, above the primary button):
  "Mooring only checked that this service accepts payments from this card's network and token. It does not vouch for the service. Allowing it lets your agent pay it up to the card's limits — whether to trust it is your decision."
  On `/allow` it is preceded by: "This request came from a link. Make sure it is a service your agent is meant to use."
  Seed row caption: "Examples, not recommendations."
- Button labels: card screen and `/allow`: `Allow <host>`; wizard: `Add to list`; already allowed: `Already allowed` (disabled).
- The denial link carries only the service URL with query string and fragment stripped; default app base `https://app.mooring.live`, overridable with `MooringClientOptions.appUrl`.
- Denied payments are never retried automatically (unchanged).
- Package versions: `@mooring-live/x402-client` → `0.2.0`, `@mooring-live/cli` → `0.2.0` (and its `.version("0.2.0")`); pins in `apps/web`, `packages/cli`, `scripts/agent` follow. Publishing is the owner's step after merge.
- Repo rules: English only; TDD; commit per task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; branch `feat/merchant-resolution`, PR to `main`, CI green before merge; never push to `main`.
- Existing suites stay green: client 73, cli 7, web 257 unit, 20 Playwright.

## Review Focus

1. A URL with embedded credentials (`https://user:pass@host/x`) → `invalid_url`, and the credentials never appear in any message or log. (Task 4)
2. A `402` whose header is not valid base64/JSON, or whose `accepts[].amount` is not a decimal integer string → `not_x402`, never a thrown 500. (Task 3, Task 5)
3. A host whose DNS answers include one public and one private address → `blocked_url` (the guard rejects if *any* resolved address is blocked). (Task 4)
4. A service name containing HTML (`<img onerror=…>`) or control characters → rendered as literal text, truncated to 64 chars, never interpreted. (Task 7)
5. Resolving a URL whose `payTo` is already in the wizard draft or on the card → `Already allowed`, no duplicate, no transaction. (Task 8, Task 9)

---

## File map

**packages/x402-client**
- Modify `src/denial.ts` — `CardPolicyDenied.merchant`, `allowMerchantUrl`.
- Modify `src/client.ts` — `appUrl` option, attach `merchant` (precheck/verify/settle), request URL plumbing.
- Modify `src/scheme.ts` — attach `merchant` (no url) on the simulate denial.
- Modify `src/index.ts` — export `allowMerchantUrl`, `DeniedMerchant`.
- Modify `package.json` (0.2.0), `README.md` (one paragraph on the link).
- Test `test/denial.test.ts`, `test/client.test.ts`, `test/scheme.test.ts`.

**packages/cli**
- Modify `src/index.ts` — print the link line; version 0.2.0. `package.json` pin + version. Test `test/cli.test.ts`.

**apps/web**
- Create `lib/merchants/terms.ts` — 402 terms normalisation + selection (pure).
- Create `lib/merchants/guard.ts` — URL validation + blocked-address check (pure, `node:net`).
- Create `lib/merchants/resolve.ts` — `resolveMerchant(url, deps)` orchestration (injectable fetch/lookup).
- Create `lib/merchants/ratelimit.ts` — token bucket.
- Create `app/api/resolve-merchant/route.ts` — thin handler.
- Create `lib/merchants/client.ts` — browser-side `resolveMerchantUrl`.
- Create `lib/merchants/seed.ts` — seed examples per network.
- Modify `lib/prefs.ts` — merchant labels.
- Create `components/merchants/MerchantResolver.tsx` — shared UI.
- Modify `components/cards/MerchantsSection.tsx`, `components/wizard/AgentStep.tsx`, `components/wizard/ConfirmStep.tsx`, `lib/wizard/validate.ts` (`merchantNames` in the draft), `lib/wizard/useCreateCard.ts` (`onMerchantAdded`), `app/cards/new/page.tsx`.
- Create `app/allow/page.tsx`, `components/merchants/AllowScreen.tsx`.
- Modify `playwright.config.ts` (env), `package.json` (dev script env), `.env.example` (comment), `vercel.json` untouched.
- Tests: `test/unit/merchants-terms.test.ts`, `merchants-guard.test.ts`, `merchants-resolve.test.ts`, `merchants-ratelimit.test.ts`, `merchants-route.test.ts`, `prefs.test.ts`, `merchant-resolver.test.tsx`, `merchants-section.test.tsx`, `wizard.test.tsx`, `allow.test.tsx`; e2e `e2e/merchants.spec.ts`.

**docs**
- Modify `docs/web-app.md` (new section + `/allow`), `docs/x402-integration.md` (`merchant`, link, `appUrl`), `README.md` (one line), `CLAUDE.md` (roadmap line).

---

### Task 1: Client — `CardPolicyDenied.merchant` and `allowMerchantUrl`

**Files:**
- Modify: `packages/x402-client/src/denial.ts`
- Modify: `packages/x402-client/src/index.ts`
- Test: `packages/x402-client/test/denial.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DeniedMerchant { payTo: string; url?: string; amount?: string; network?: string }
  // CardPolicyDenied constructor opts gains `merchant?: DeniedMerchant`; instance has `readonly merchant?: DeniedMerchant`.
  export const DEFAULT_APP_URL = "https://app.mooring.live";
  export function allowMerchantUrl(appBaseUrl: string, card: string, serviceUrl: string): string
  // → `${appBaseUrl without trailing slash}/allow?card=${card}&url=${encodeURIComponent(origin+pathname of serviceUrl)}`
  export function stripQuery(url: string): string  // origin + pathname; invalid URL → returned unchanged
  ```
- Message rule: when `reason === "not_allowlisted"` and `merchant?.url` is present, the message ends with ` — allow it: <allowMerchantUrl(appUrl, card, url)>`; the constructor therefore also takes `opts.appUrl?: string` and `opts.card?: string` (both optional; link only when all three present).

- [ ] **Step 1: Write the failing tests** in `test/denial.test.ts`:

```ts
it("allowMerchantUrl strips the query string and fragment", () => {
  expect(allowMerchantUrl("https://app.mooring.live/", "CBOO", "https://api.x.dev/weather?key=SECRET#frag"))
    .toBe("https://app.mooring.live/allow?card=CBOO&url=https%3A%2F%2Fapi.x.dev%2Fweather");
});
it("not_allowlisted with merchant.url appends the allow link to the message", () => {
  const err = new CardPolicyDenied("not_allowlisted", "precheck", {
    merchant: { payTo: "GBSV", url: "https://demo.rail402.dev/weather?x=1", amount: "10000", network: "stellar:testnet" },
    card: "CBOO", appUrl: "https://app.mooring.live",
  });
  expect(err.merchant?.payTo).toBe("GBSV");
  expect(err.message).toContain("allow it: https://app.mooring.live/allow?card=CBOO&url=https%3A%2F%2Fdemo.rail402.dev%2Fweather");
  expect(err.message).not.toContain("x=1");
});
it("no link without a url, and never for other reasons", () => {
  expect(new CardPolicyDenied("not_allowlisted", "simulate", { merchant: { payTo: "GBSV" }, card: "CBOO" }).message).not.toContain("allow it");
  expect(new CardPolicyDenied("over_budget", "precheck", { merchant: { payTo: "GBSV", url: "https://a.b/c" }, card: "CBOO" }).message).not.toContain("allow it");
});
```

- [ ] **Step 2: Run** `npm test -w @mooring-live/x402-client -- denial` → FAIL (`allowMerchantUrl` not exported / `merchant` undefined).
- [ ] **Step 3: Implement** `DeniedMerchant`, `DEFAULT_APP_URL`, `stripQuery`, `allowMerchantUrl`, the constructor options and message suffix in `denial.ts`; export `allowMerchantUrl`, `DEFAULT_APP_URL`, `type DeniedMerchant` from `index.ts`.
- [ ] **Step 4: Run** the same command → PASS; `npm run typecheck -w @mooring-live/x402-client` clean.
- [ ] **Step 5: Commit** `feat(client): CardPolicyDenied.merchant and allowMerchantUrl`.

### Task 2: Client — attach `merchant` at every stage; CLI prints the link; version 0.2.0

**Files:**
- Modify: `packages/x402-client/src/client.ts`, `src/scheme.ts`, `package.json`, `README.md`
- Modify: `packages/cli/src/index.ts`, `packages/cli/package.json`
- Modify pins: `apps/web/package.json`, `scripts/agent/package.json`; run `npm install` to refresh `package-lock.json`.
- Test: `packages/x402-client/test/client.test.ts`, `test/scheme.test.ts`, `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `MooringClientOptions.appUrl?: string` (default `DEFAULT_APP_URL`). `createMooringClient(opts, box?, requestUrl?: string)` — third optional parameter (internal; `createMooringFetch` passes `stripQuery(String(input instanceof Request ? input.url : input))`). Every `CardPolicyDenied` built in `client.ts` and `scheme.ts` receives `card: opts.card`, `appUrl`, and `merchant: { payTo: req.payTo, amount: req.amount, network: req.network, url: requestUrl }` when a `PaymentRequirements`/`selectedRequirements` is in scope (precheck, simulate, verify, settle); `url` omitted when `requestUrl` is undefined.
- CLI: after `Denied (${reason}) at ${stage}` prints a second line `Allow it: <link>` when `err.merchant?.url` is set (the link is `allowMerchantUrl(DEFAULT_APP_URL, opts.card, err.merchant.url)`); exit code stays 2.

- [ ] **Step 1: Write failing tests.** In `client.test.ts` (reuse the existing fetch stub pattern that answers a 402 for a non-allowlisted `payTo`):

```ts
it("not_allowlisted at precheck carries merchant and the allow link with the request url", async () => {
  const fetchWithPayment = createMooringFetch({ card, agent, network: "stellar:testnet", rpcUrl, fetch: stub402NotAllowlisted });
  const err = await fetchWithPayment("https://demo.rail402.dev/weather?city=ist").catch((e) => e);
  expect(err).toBeInstanceOf(CardPolicyDenied);
  expect(err.merchant).toEqual({ payTo: STRANGER, amount: "10000", network: "stellar:testnet", url: "https://demo.rail402.dev/weather" });
  expect(err.message).toContain("/allow?card=" + card + "&url=https%3A%2F%2Fdemo.rail402.dev%2Fweather");
});
it("createMooringClient used standalone sets merchant without url and no link", ...);  // onDenial hook receives merchant.url === undefined
```
In `scheme.test.ts`: the simulate denial for `not_allowlisted` has `merchant.payTo === req.payTo` and no `url`. In `cli.test.ts`: a `createMooringFetch` stub that rejects with a `CardPolicyDenied` carrying `merchant.url` → output lines `["Denied (not_allowlisted) at precheck", "Allow it: https://app.mooring.live/allow?card=C…&url=…"]`, exit code 2; without `url` only the first line.

- [ ] **Step 2: Run** `npm test -w @mooring-live/x402-client -w @mooring-live/cli` → the new tests FAIL.
- [ ] **Step 3: Implement** the plumbing described in Interfaces; bump `packages/x402-client/package.json` and `packages/cli/package.json` to `0.2.0`, CLI `.version("0.2.0")`, pins to `0.2.0` in `apps/web`, `packages/cli`, `scripts/agent`; `npm install`; add the "Allowing a merchant from a denial" paragraph (link format, `appUrl`, query stripped) to the client README.
- [ ] **Step 4: Run** `npm run build && npm run typecheck && npm test -w @mooring-live/x402-client -w @mooring-live/cli` → PASS (73+ and 7+ tests).
- [ ] **Step 5: Commit** `feat(client,cli): merchant terms and /allow link on not_allowlisted; 0.2.0`.

### Task 3: Web — 402 terms normalisation and selection

**Files:**
- Create: `apps/web/lib/merchants/terms.ts`
- Test: `apps/web/test/unit/merchants-terms.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MerchantTerms { scheme: string; network: string; asset: string; payTo: string; amount: string }
  export interface ServiceMeta { name?: string; description?: string; iconUrl?: string }
  export interface ParsedTerms { accepts: MerchantTerms[]; service: ServiceMeta; feesSponsored?: boolean }
  export function parsePaymentRequired(header: string | null, body: string | null): ParsedTerms | null
  //  header (v2, base64 JSON via decodePaymentRequiredHeader from "@x402/core/http") takes precedence; body (v1 JSON, accepts[].maxAmountRequired) otherwise; null when neither parses.
  //  An entry missing any of the five fields, or whose amount is not /^[0-9]+$/, is dropped (not the whole result).
  //  service: name from resource.serviceName ?? extensions.bazaar.info.serviceName ?? top-level serviceName (≤64 chars), description from resource.description ?? description (≤280), iconUrl only when it starts with "https://". feesSponsored from accepts[0].extra.areFeesSponsored.
  export type Selection = { kind: "one"; terms: MerchantTerms } | { kind: "none" } | { kind: "many"; found: MerchantTerms[] }
  export function selectTerms(parsed: ParsedTerms, network: string, asset: string): Selection
  //  candidates = accepts with scheme "exact" && network && asset; one → "one"; zero → "none"; >1 distinct payTo → "many"; >1 with the same payTo → "one" (first).
  ```

- [ ] **Step 1: Write failing tests** with fixtures: a v2 header built with `encodePaymentRequiredHeader` from `@x402/core/http` carrying two entries (testnet USDC → `GBSV…`, pubnet USDC → `GDK3…`) and `resource: { url, description: "Current weather for a city" }`; a v1 body `{"x402Version":1,"accepts":[{"scheme":"exact","network":"stellar:testnet","asset":SAC,"payTo":"GBSV…","maxAmountRequired":"10000"}]}`; a malformed header `"@@@"`; an entry with `amount: "0.001"`.

```ts
it("parses a v2 header and keeps resource metadata", ...);  // accepts.length 2, service.description === "Current weather for a city"
it("parses a v1 body when there is no header", ...);          // amount "10000"
it("returns null for garbage", () => expect(parsePaymentRequired("@@@", "not json")).toBeNull());
it("drops entries whose amount is not an integer string", ...);
it("caps and sanitises service strings", () => { /* name of 100 chars → 64; iconUrl "http://…" → undefined */ });
it("selectTerms picks the single network+asset match", ...);
it("selectTerms reports none with nothing matching", ...);
it("selectTerms reports many when two matches pay different addresses", ...);
```

- [ ] **Step 2: Run** `npm test -w @mooring/web -- merchants-terms` → FAIL.
- [ ] **Step 3: Implement** `terms.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): parse and select x402 payment terms`.

### Task 4: Web — URL guard (SSRF)

**Files:**
- Create: `apps/web/lib/merchants/guard.ts`
- Test: `apps/web/test/unit/merchants-guard.test.ts` (first line `// @vitest-environment node`)

**Interfaces:**
- Produces:
  ```ts
  export type GuardError = { code: "invalid_url" | "blocked_url"; message: string }
  export function validateUrl(raw: string, opts: { allowLocal: boolean }): { ok: true; url: URL } | { ok: false } & GuardError
  //  invalid_url: unparsable, scheme not http/https, http without allowLocal, username/password present, length > 2048.
  export function isBlockedAddress(ip: string): boolean
  //  IPv4: 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, 224/4, 240/4; IPv6: ::, ::1, fc00::/7, fe80::/10, ::ffff:<blocked v4>.
  export async function assertHostAllowed(url: URL, opts: { allowLocal: boolean; lookup: (host: string) => Promise<string[]> }): Promise<GuardError | null>
  //  literal IP → isBlockedAddress; "localhost" / "*.localhost" → blocked; otherwise every address from lookup must pass; allowLocal skips all of it. Messages: "That address is not allowed." (never the host).
  ```

- [ ] **Step 1: Write failing tests**: `validateUrl("https://user:pass@a.b/x")` → `invalid_url` and message does not contain `pass`; `validateUrl("http://a.b/x", {allowLocal:false})` → `invalid_url`; `("javascript:alert(1)")` → `invalid_url`; `isBlockedAddress` table for `127.0.0.1`, `10.1.2.3`, `169.254.169.254`, `172.31.0.1`, `100.64.0.1`, `::1`, `fd00::1`, `::ffff:192.168.0.1` → true and `93.184.216.34`, `2606:4700::1` → false; `assertHostAllowed` with `lookup` returning `["93.184.216.34", "10.0.0.5"]` → `blocked_url`; `localhost` with `allowLocal: true` → null.
- [ ] **Step 2: Run** `npm test -w @mooring/web -- merchants-guard` → FAIL.
- [ ] **Step 3: Implement** `guard.ts` (use `node:net` `isIP`; no new dependency).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): resolver URL guard`.

### Task 5: Web — `resolveMerchant`, rate limit, and the route handler

**Files:**
- Create: `apps/web/lib/merchants/resolve.ts`, `apps/web/lib/merchants/ratelimit.ts`, `apps/web/app/api/resolve-merchant/route.ts`
- Test: `apps/web/test/unit/merchants-resolve.test.ts`, `merchants-ratelimit.test.ts`, `merchants-route.test.ts` (all `// @vitest-environment node`)

**Interfaces:**
- Consumes: Task 3 (`parsePaymentRequired`, `selectTerms`), Task 4 (`validateUrl`, `assertHostAllowed`).
- Produces:
  ```ts
  export type ResolveOk = { ok: true; url: string; payTo: string; network: string; asset: string; amount: string; scheme: string; service?: ServiceMeta; feesSponsored?: boolean }
  export type ResolveErrCode = "invalid_url" | "blocked_url" | "unreachable" | "not_x402" | "no_match" | "ambiguous"
  export type ResolveErr = { ok: false; code: ResolveErrCode; message: string; found?: Array<Pick<MerchantTerms, "network" | "asset" | "payTo" | "amount">> }
  export type ResolveResult = ResolveOk | ResolveErr
  export interface ResolveDeps { fetch: typeof globalThis.fetch; lookup: (host: string) => Promise<string[]>; network: string; asset: string; allowLocal: boolean; userAgent: string; timeoutMs?: number /* 5000 */ }
  export async function resolveMerchant(rawUrl: string, deps: ResolveDeps): Promise<ResolveResult>
  //  GET with redirect: "manual"; on 301/302/303/307/308 follow Location (max 3, re-run assertHostAllowed each hop); status !== 402 → one POST {} retry; 402 → header ?? capped body (64 KiB via reader) → parse → select.
  //  messages: no_match "This service accepts <network list>; this card holds <network> USDC." (network shown as "Stellar testnet"/"Stellar mainnet"); ambiguous "This service lists more than one address for this network — add it by address instead."; unreachable "Could not reach that service."; not_x402 "That URL did not answer with x402 payment terms (HTTP <status>)."
  // ratelimit.ts
  export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): { take(key: string): boolean }
  // route.ts
  export const runtime = "nodejs"; export async function POST(req: Request): Promise<Response>
  //  body { url: string } else 400 { ok:false, code:"invalid_url", … }; key = x-forwarded-for first hop ?? "local"; limiter 30/60s → 429 { ok:false, code:"unreachable", message:"Too many lookups, try again in a minute." }; deps from config + process.env.MOORING_RESOLVER_ALLOW_LOCAL === "1" + dns.promises.lookup(host, {all:true}); headers Cache-Control: no-store.
  ```

- [ ] **Step 1: Write failing tests** for `resolveMerchant` with a scripted `fetch` (an array of responses consumed in order) and `lookup: async () => ["93.184.216.34"]`:
  - v2 402 on GET → `ok`, `payTo`, `amount: "10000"`, `service.description`;
  - GET 404 then POST 402 → `ok` and the second call used `method: "POST"`;
  - GET 200, POST 200 → `not_x402` with "HTTP 200";
  - 302 → private IP (lookup returns `["10.0.0.1"]` for the second host) → `blocked_url`;
  - 4 redirects → `unreachable`;
  - fetch rejects / aborts → `unreachable`;
  - pubnet-only terms → `no_match` with `found[0].network === "stellar:pubnet"` and message containing "Stellar mainnet";
  - body larger than 64 KiB with no header → `not_x402` (no throw);
  - `allowLocal: true` with `http://localhost:3001/weather` → `ok`.
  `ratelimit`: 30 takes true, 31st false, after `windowMs` true again. `route`: POST with `{ url: "nope" }` → 400 JSON `invalid_url`; a valid request with `fetch` mocked via `vi.stubGlobal` → 200 JSON `ok:true` and `cache-control: no-store`; 31 requests from one IP → last is 429.
- [ ] **Step 2: Run** `npm test -w @mooring/web -- merchants-` → FAIL.
- [ ] **Step 3: Implement** the three files. In `route.ts` keep the handler thin; read `MOORING_RESOLVER_ALLOW_LOCAL` with a literal `process.env.MOORING_RESOLVER_ALLOW_LOCAL` read (server only, not `NEXT_PUBLIC`). `userAgent` = `mooring-resolver/` + the web package version (import `package.json` with `resolveJsonModule` or hard-code `"0.1.0"` next to a comment).
- [ ] **Step 4: Run** → PASS; `npm run typecheck -w @mooring/web` clean.
- [ ] **Step 5: Commit** `feat(web): /api/resolve-merchant`.

### Task 6: Web — merchant labels in prefs and the seed list

**Files:**
- Modify: `apps/web/lib/prefs.ts`
- Create: `apps/web/lib/merchants/seed.ts`
- Test: `apps/web/test/unit/prefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MerchantLabel { name: string; url: string }
  export function getMerchantLabels(owner: string, card: string): Record<string, MerchantLabel>   // key mooring:<owner>:merchants:<card>
  export function setMerchantLabel(owner: string, card: string, payTo: string, label: MerchantLabel): void
  export function removeMerchantLabel(owner: string, card: string, payTo: string): void
  // seed.ts
  export interface SeedService { name: string; url: string; note: string }
  export function seedServices(network: string, allowLocal: boolean): SeedService[]
  //  testnet: [{ name: "Rail402 demo", url: "https://demo.rail402.dev/weather", note: "Current weather, 0.001 USDC" }]; when allowLocal also [{ name: "Example merchant (local)", url: "http://localhost:3001/weather", note: "examples/merchant-server" }]; pubnet: [].
  ```
  `allowLocal` on the client comes from `config.walletMode === "mock"` **only for showing the seed row**; the server decides whether to resolve it.

- [ ] **Step 1: Write failing tests**: set two labels on one card, read them back keyed by `payTo`; remove one; labels are isolated per owner and per card; a storage that throws (mock `localStorage.setItem` to throw) does not propagate; `seedServices("stellar:testnet", false)` has one entry with the Rail402 URL and `seedServices("stellar:pubnet", false)` is empty.
- [ ] **Step 2: Run** `npm test -w @mooring/web -- prefs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): per-device merchant labels and seed services`.

### Task 7: Web — `MerchantResolver` component and browser client

**Files:**
- Create: `apps/web/lib/merchants/client.ts`, `apps/web/components/merchants/MerchantResolver.tsx`
- Test: `apps/web/test/unit/merchant-resolver.test.tsx`

**Interfaces:**
- Consumes: `ResolveResult` type (Task 5), `seedServices` (Task 6), `Field`, `Button`, `formatUsdc`, `shortAddress`, `config`.
- Produces:
  ```ts
  // client.ts
  export async function resolveMerchantUrl(url: string, fetchImpl = globalThis.fetch): Promise<ResolveResult>
  //  POST /api/resolve-merchant; non-JSON or network failure → { ok:false, code:"unreachable", message:"Could not reach the lookup service." }
  // MerchantResolver.tsx
  export interface ResolvedMerchant { payTo: string; url: string; host: string; name: string; description?: string; amount: string; network: string }
  export interface MerchantResolverProps {
    initialUrl?: string; autoResolve?: boolean;
    existing: readonly string[];                 // payTo values already allowed/in the draft
    onConfirm: (m: ResolvedMerchant) => void | Promise<void>;
    onAddByAddress?: (address: string) => void;  // when provided, the "Add by address instead" disclosure is shown
    confirmLabel: (host: string) => string;      // e.g. (h) => `Allow ${h}` or () => "Add to list"
    confirming?: boolean; disabled?: boolean; linkOrigin?: boolean;   // linkOrigin adds the /allow extra sentence
    resolve?: typeof resolveMerchantUrl;         // injectable for tests
  }
  export function MerchantResolver(props: MerchantResolverProps): JSX.Element
  ```
  Copy: field label "Service URL", placeholder `https://api.example.com/weather`, button "Look up", seed caption "Examples, not recommendations.", notice text from Global Constraints, "Already allowed" disabled button when `existing.includes(payTo)`, failure keeps `message` and renders `found[]` as "This service accepts: Stellar mainnet USDC → GDK3…XXB" lines. Price line: `${formatUsdc(amount)} USDC / request`. Preview container `role="group"` `aria-label={`Service ${name}`}`. Enter in the field triggers Look up.

- [ ] **Step 1: Write failing tests** (render with an injected `resolve`):
  - typing a URL and pressing Enter calls `resolve` once and shows the preview with name, `0.001 USDC / request`, `Stellar testnet`, shortened `payTo`, the notice text, and a button `Allow demo.rail402.dev`;
  - `existing` containing the `payTo` → button text `Already allowed`, disabled;
  - a `no_match` result → message visible, "This service accepts:" lines visible, no primary button, still visible after clicking "Try again"-less rerender (state persists until the URL input changes);
  - `linkOrigin` → the extra sentence "This request came from a link…" is present;
  - a service name `<img src=x onerror=alert(1)>` of 100 chars is rendered as text (no `img` element in the DOM) and truncated to 64 chars;
  - seed row present on testnet with "Rail402 demo", absent when `seedServices` returns `[]`;
  - clicking "Add by address instead" reveals the address field and submitting `G…` calls `onAddByAddress`.
- [ ] **Step 2: Run** `npm test -w @mooring/web -- merchant-resolver` → FAIL.
- [ ] **Step 3: Implement** both files with the existing primitives and tokens (follow `MerchantsSection`'s class constants).
- [ ] **Step 4: Run** → PASS; also run the a11y unit helper if the suite has one (`axe` in `details.test.tsx` pattern) on the resolved state.
- [ ] **Step 5: Commit** `feat(web): MerchantResolver`.

### Task 8: Web — card screen: resolver + names in `MerchantsSection`

**Files:**
- Modify: `apps/web/components/cards/MerchantsSection.tsx`
- Test: `apps/web/test/unit/merchants-section.test.tsx` (new; `details.test.tsx` already renders the section and must stay green)

**Interfaces:**
- Consumes: Task 6 (`getMerchantLabels`, `setMerchantLabel`, `removeMerchantLabel`), Task 7 (`MerchantResolver`), `useWallet().address` for the owner key.
- Produces: `MerchantsSection` renders, per merchant, the label name on line one (when known) and `shortAddress(payTo)` on line two; "+ Add" opens `MerchantResolver` with `existing={merchants}`, `confirmLabel={(h) => \`Allow ${h}\`}`, `onConfirm` → `add.run(m.payTo)` then on `onDone` `setMerchantLabel(owner, address, m.payTo, { name: m.name, url: m.url })`; `onAddByAddress` → `add.run(address)`; `remove` also calls `removeMerchantLabel`.

- [ ] **Step 1: Write failing tests** (mock `useCardOp` as `details.test.tsx` does, inject `resolve` through a `resolver` prop or module mock): resolving and confirming calls `add.run` with the resolved `payTo`; after `onDone` the label is stored and the list shows "Rail402 demo" above `GBSV…ELYP`; removing clears the label; an existing merchant is offered as "Already allowed".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w @mooring/web` → PASS (full web suite).
- [ ] **Step 5: Commit** `feat(web): add merchants by URL on the card screen`.

### Task 9: Web — wizard: resolver in `AgentStep`, names in the draft and confirm step

**Files:**
- Modify: `apps/web/lib/wizard/validate.ts` (`WizardDraft.merchantNames: Record<string, MerchantLabel>`, `emptyDraft`), `components/wizard/AgentStep.tsx`, `components/wizard/ConfirmStep.tsx` (`merchantNames` prop; notice once above the list), `lib/wizard/useCreateCard.ts` (`onMerchantAdded?: (card: string, merchant: string) => void` in the flow options, called after each confirmed `add_merchant`), `app/cards/new/page.tsx` (passes `merchantNames`, stores labels via `setMerchantLabel` in `onMerchantAdded`).
- Test: `apps/web/test/unit/wizard-validate.test.ts`, `wizard.test.tsx`

**Interfaces:**
- Consumes: Task 6, Task 7, `addMerchant(list, candidate)` (unchanged).
- Produces: in `AgentStep`, `MerchantResolver` with `existing={draft.merchants}`, `confirmLabel={() => "Add to list"}`, `onConfirm` → `patch({ merchants: addMerchant(draft.merchants, m.payTo).merchants, merchantNames: { ...draft.merchantNames, [m.payTo]: { name: m.name, url: m.url } } })`; the 32-cap error from `addMerchant` surfaces in the resolver's error slot; `onAddByAddress` keeps today's path.

- [ ] **Step 1: Write failing tests**: `emptyDraft().merchantNames` is `{}`; in `wizard.test.tsx` (existing `render(<NewCardPage />)` harness with the resolver injected via module mock of `@/lib/merchants/client`): resolving a URL on step 2 and clicking "Add to list" adds the `payTo` to the list with "Rail402 demo" shown; resolving the same URL again shows "Already allowed"; the confirm step shows the name and the notice; after the flow's merchant transaction confirms, `getMerchantLabels(owner, card)` contains the label.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w @mooring/web` → PASS.
- [ ] **Step 5: Commit** `feat(web): add merchants by URL in the wizard`.

### Task 10: Web — `/allow` page

**Files:**
- Create: `apps/web/app/allow/page.tsx` (wraps in `NetworkGuard` like `/cards`; reads `useSearchParams`), `apps/web/components/merchants/AllowScreen.tsx`
- Test: `apps/web/test/unit/allow.test.tsx`

**Interfaces:**
- Consumes: `useCardInfo`, `useMerchants`, `useCardOp`, `addCard`, `setSelected`, `setMerchantLabel`, `MerchantResolver`, `StrKey.isValidContract`.
- Produces: `AllowScreen({ card, url }: { card: string | null; url: string | null })`:
  - `card` missing/invalid → "This link does not name a valid card." + link to `/cards`;
  - `info.owner !== wallet.address` → "This card belongs to <shortAddress(owner)>. Connect that wallet to manage it." (no resolver);
  - otherwise header with the card's label and address, `MerchantResolver` with `initialUrl={url}`, `autoResolve={!!url}`, `linkOrigin`, `existing={merchants}`, `confirmLabel={(h) => \`Allow ${h}\`}`; on confirmed add: `setMerchantLabel`, `addCard(owner, card)`, `setSelected(owner, card)`, then a "Open card" link to `/cards` (no auto-navigation, so the toast stays readable).

- [ ] **Step 1: Write failing tests** (mock hooks as `details.test.tsx` does): invalid card param → error copy; foreign owner → refusal copy with the shortened owner; owner match + `url` → resolver auto-resolves (injected `resolve` called with the url) and shows `Allow demo.rail402.dev`; confirm → `add.run(payTo)`; after done → label stored, `addCard` called, "Open card" link `href="/cards"`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w @mooring/web` and `npm run typecheck -w @mooring/web` → PASS.
- [ ] **Step 5: Commit** `feat(web): /allow route for merchant approval links`.

### Task 11: e2e, local env wiring, docs

**Files:**
- Create: `apps/web/e2e/merchants.spec.ts`
- Modify: `apps/web/playwright.config.ts` (`env: { ...appEnv, MOORING_RESOLVER_ALLOW_LOCAL: "1" }`), `apps/web/package.json` (`"dev": "MOORING_RESOLVER_ALLOW_LOCAL=1 next dev"`), `apps/web/.env.example` (comment line documenting `MOORING_RESOLVER_ALLOW_LOCAL`, server-only), `docs/web-app.md`, `docs/x402-integration.md`, `README.md`, `CLAUDE.md`.

**Interfaces:**
- Consumes: everything above. The e2e stubs `**/api/resolve-merchant` with `page.route` (fulfil JSON `ResolveOk` / `no_match`) — the real route is exercised by unit tests; the spec says stub.

- [ ] **Step 1: Write the e2e** (`e2e/merchants.spec.ts`, using `installRpcMock` + `connectWallet` from the fixtures):
  - wizard: step 2 → paste URL → Look up → "Add to list" → list shows "Rail402 demo" → create card → merchant transaction runs (RPC mock) → `/cards` shows the name;
  - card screen: "+ Add" → URL → `Allow demo.rail402.dev` → RPC mock confirms → name in list;
  - `/allow?card=<mock card>&url=https://demo.rail402.dev/weather` → auto-resolved preview with the link sentence → allow → "Open card";
  - `no_match` stub → message "Stellar mainnet" visible and no Allow button;
  - "Add by address instead" still adds a raw `G…`;
  - axe check on the resolved state (reuse `a11y.spec.ts` helper).
- [ ] **Step 2: Run** `npm run e2e -w @mooring/web` → the new spec FAILS until wiring is complete (it may already pass if Tasks 7–10 are done; either way it must pass at the end).
- [ ] **Step 3: Wire** the env in `playwright.config.ts`, the `dev` script, `.env.example`; write the docs: `docs/web-app.md` gains "Adding a merchant by URL" (resolver behaviour, the notice, `/allow`, `MOORING_RESOLVER_ALLOW_LOCAL`, seed list) and a `/allow` row in the route table; `docs/x402-integration.md` gains `merchant`, the link, `appUrl`, the CLI's second line; `README.md` one line under the CLI example; `CLAUDE.md` roadmap: "merchant directory (flow 3) next".
- [ ] **Step 4: Run** `npm run e2e -w @mooring/web` → PASS (20 + new flows); `npm test`, `npm run typecheck` at the root → PASS; `grep -rl CBMSK4OSNLBEXTJWNEWX422RPVDEUNFEWADTSPECGBI26ESDYW65AUSE apps/web/.next/static/chunks` still finds the factory inlined; `git grep -n "process.env\[" apps/web/lib` empty.
- [ ] **Step 5: Commit** `feat(web): merchant-by-URL e2e, local resolver env, docs`.

### Task 12: Manual testnet verification and PR

- [ ] **Step 1:** `npm run dev -w @mooring/web` with the real wallet; on an existing card, resolve and allow `https://demo.rail402.dev/weather` (Freighter prompt, hash on the toast); confirm "Rail402 demo" shows in the list.
- [ ] **Step 2:** From the workspace CLI (`node packages/cli/dist/index.js`), `mooring pay https://try-cli-jukj.onrender.com/fortune --card <that card>` → `Denied (not_allowlisted) at precheck` followed by `Allow it: https://app.mooring.live/allow?...`; open the link locally by swapping the host to `localhost:3000`, approve, re-run `mooring pay` → HTTP 200. Record both hashes in `docs/testnet.md` ("Merchant resolution (date)").
- [ ] **Step 3:** Open the PR `feat: add merchants by URL and the /allow denial link` with the summary, the hashes, and the note that `0.2.0` of both packages is to be published by the owner after merge; CI green → merge.
