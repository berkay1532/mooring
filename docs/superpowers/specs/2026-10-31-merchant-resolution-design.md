# Merchant resolution — add a merchant by URL, not by address

**Date:** 2026-10-31 · **Status:** draft for owner review · **Scope:** `apps/web`, `packages/x402-client`, `packages/cli`

## Intent

Today a card's allowlist is edited by pasting a `G…`/`C…` address, in the wizard and on the card
screen. The owner decided this must not be the primary path: typing an address is a hard ask, and
nobody has one at hand. What people have is the **URL of the x402 service** their agent calls, or
the **error their agent just printed** when the card refused to pay it.

x402 already publishes everything we need: the service answers any unpaid request with `402` and a
`PAYMENT-REQUIRED` header whose `accepts[]` carries `payTo`, `network`, `asset` and the price. So
the app resolves a URL into a merchant, shows what it found, and the owner approves it with one
Freighter signature. The raw address stays available as an advanced fallback.

This is also the groundwork for flow 1 (the denial links straight to the approval screen) and
flow 3 (a directory fed from discovery endpoints). Order agreed with the owner: **2 → 1 → 3**. This
document covers 2 and 1; 3 is a later design, except for a static "try one of these" seed.

## Goals

- An owner adds a merchant by pasting the service URL, in the wizard **and** on the card screen.
- The app shows what it resolved (service name, description, price, network, asset, `payTo`)
  before anything is signed, and refuses a service the card cannot pay, saying why.
- An agent's `not_allowlisted` denial carries a link that opens that approval screen with the
  URL prefilled, for both developers (CLI / `CardPolicyDenied`) and people who only see a hosted
  agent's error text.
- Resolved names are shown in the allowlist instead of bare addresses when known.
- No change to the contract; no new wallet prompts beyond the existing one per `add_merchant`.
- **The owner, not Mooring, decides who the card may pay.** The app screens services only on
  technical grounds (answers x402, matches the card's network and asset). It never vouches for a
  service, and the UI says so where the decision is made (owner's requirement, 2026-10-31).

## Non-goals

- A merchant directory / search (flow 3). Only a static seed list of two or three example services.
- Automatic retry of the denied payment after the owner allows the merchant. Existing rule stands:
  denied payments are never retried by the client; the agent's next call succeeds.
- Cross-device persistence of merchant names (needs the indexer, v1.1).
- Batching several `add_merchant` calls into one transaction (needs the v3 constructor).
- Resolving services that require authentication before they answer `402`.

## Anti-goals (would make this a failure even if it "works")

- Presenting a resolved service as endorsed, vetted or safe. Resolution is a technical check.
- Trusting anything carried in a link or typed by the user as the address to allow. The address
  shown and signed must come from a resolution the app performed itself.
- Turning the resolver into an open proxy or an SSRF vector.
- A UI that silently falls back to the address field when resolution fails, so the owner never
  learns the service is not payable by this card.

## Constraints

- Browsers cannot read a third-party `402`: most services send no CORS headers, and
  `PAYMENT-REQUIRED` is not CORS-safelisted. Resolution runs **server side**, in a Next.js route
  handler inside `apps/web` (Node runtime on Vercel). The deployment already runs there; nothing new.
- The card pays exactly one asset on one network (`NEXT_PUBLIC_USDC_SAC` on
  `NEXT_PUBLIC_STELLAR_NETWORK`). A service whose `accepts[]` has no entry for that pair is not
  payable by the card.
- `add_merchant` is one owner transaction per address (unchanged).
- Existing conventions apply: literal `NEXT_PUBLIC_*` reads, `useCardOp` + `TxToast` for owner
  actions, `Field`/`Button`/`Sheet` primitives, byte-counted labels, per-card busy lock, Playwright
  e2e with route-intercepted RPC, 257 unit tests stay green.

## Design

### 1. The resolver (server route)

`POST /api/resolve-merchant` with body `{ "url": string }`. Returns one of:

```ts
type ResolveOk = {
  ok: true;
  url: string;                 // the URL actually resolved (after allowed redirects)
  payTo: string;               // G… or C…, from the matching accepts[] entry
  network: string;             // CAIP-2, e.g. "stellar:testnet"
  asset: string;               // SAC contract id
  amount: string;              // smallest units, as the 402 states it ("10000" = 0.001 USDC)
  scheme: string;              // "exact"
  service?: { name?: string; description?: string; iconUrl?: string }; // from resource/extensions when present
  feesSponsored?: boolean;
};
type ResolveErr = {
  ok: false;
  code: "invalid_url" | "blocked_url" | "unreachable" | "not_x402" | "no_match" | "ambiguous";
  message: string;             // one sentence for the UI
  found?: Array<{ network: string; asset: string; payTo: string; amount: string }>; // for no_match / ambiguous
};
```

Behaviour:

1. Validate the URL: `http:` or `https:` only, host present, no credentials in the URL. Reject
   hosts that resolve to loopback, link-local, private or unique-local ranges, and literal IPs in
   those ranges (DNS resolved by the route before fetching, and re-checked on each redirect hop).
   `blocked_url` names the reason without echoing the host. *(Author's call after review:)* the
   block is lifted only when the **server-side** env `MOORING_RESOLVER_ALLOW_LOCAL=1` is set. It is
   never set on Vercel; `npm run dev` and the Playwright `webServer` set it so the local example
   merchant (`localhost:3001`) and stubbed local sellers resolve. The gate is not `NODE_ENV` (the
   e2e suite runs a production build) and not the mock wallet (a client-side flag must not open a
   server-side hole). `http:` is accepted only under the same flag; otherwise `https:` only.
2. Fetch with `GET`, no body, `Accept: application/json`, a fixed `User-Agent`
   (`mooring-resolver/<version>`), 5 s timeout, manual redirect handling (max 3 hops, same
   validation per hop). The response body is read only when the status is `402` and there is no
   `PAYMENT-REQUIRED` header (the x402 **v1** shape puts the terms in the JSON body), and then at
   most 64 KiB; otherwise it is discarded unread.
3. If the status is not `402`, retry once with `POST` and an empty JSON body (`{}`), because some
   routes are POST-only. If still not `402` → `not_x402` (status included in the message). A `402`
   with neither a header nor a parseable JSON body is also `not_x402`.
4. Decode the terms: v2 from the `PAYMENT-REQUIRED` header (base64 JSON), v1 from the body
   (`x402Version: 1`, `accepts[].maxAmountRequired`); normalise both into the same
   `{scheme, network, asset, payTo, amount}` entries. Each entry must have all five. *(Author's
   call after review: v1 is supported because `@x402/fetch` itself reads it; the only cost is a
   size-capped body read on a `402`.)*
5. Select the entries matching the deployment's network **and** asset, scheme `exact`.
   - exactly one → `ok`;
   - none → `no_match` with `found[]` so the UI can say "this service wants Stellar mainnet USDC,
     this card holds testnet USDC";
   - more than one → `ambiguous` with `found[]` (we do not guess between two addresses).
6. `service` is filled from `resource` / `extensions.bazaar.info` / top-level `description`,
   `serviceName`, `iconUrl` when present; all strings are length-capped (name 64, description 280)
   and treated as untrusted text by the UI (never rendered as HTML, `iconUrl` only used if `https:`).
7. Rate limit: 30 requests per minute per client IP (in-memory token bucket per instance, good
   enough on Fluid Compute; abuse beyond that is Vercel's firewall's job). Response
   `Cache-Control: no-store`.

The route is the only place in the app that fetches arbitrary URLs. It has unit tests with a
mocked `fetch` for every branch above (including each SSRF rejection, redirect hops, POST
fallback, v1/v2 header shapes, `no_match`, `ambiguous`) and one e2e that stubs the route.

**Builder's call, marked:** DNS resolution for the private-range check uses Node's `dns.lookup`
with `all: true`; if any resolved address is in a blocked range, the request is refused.

### 2. The approval UI — `MerchantResolver`

One shared client component used by both screens. State machine:

`idle → resolving → resolved | failed`

- **idle:** a single `Field` labelled "Service URL" with placeholder `https://api.example.com/weather`,
  a "Look up" button, and below it a small "Try one of these" row with the static seed (the
  example merchant server at `localhost:3001/weather` **only** when `NEXT_PUBLIC_WALLET=mock` or in
  dev; Rail402 demo `https://demo.rail402.dev/weather` on testnet). Under it a disclosure
  "Add by address instead" that reveals today's address field unchanged.
- **resolving:** button shows progress; the field is disabled.
- **resolved:** a preview card: service name (or the URL's host when no name), description,
  price formatted as USDC with up to 7 decimals trimmed (`0.001 USDC / request`), network, and the
  `payTo` address shortened with a copy affordance and full value on hover. Primary button:
  "Allow this merchant" (card screen) / "Add to list" (wizard). If `payTo` is already on the list,
  the button is replaced by "Already allowed".
- **failed:** the `message` from the route, plus `found[]` rendered as "This service accepts: …"
  when present. "Try again" and the address disclosure remain available. The failure stays on
  screen until the URL changes (anti-goal: no silent fallback).

Every **resolved** preview carries, directly above the primary button, a short responsibility
notice in plain text (not a tooltip, not collapsible):

> Mooring only checked that this service accepts payments from this card's network and token.
> It does not vouch for the service. Allowing it lets your agent pay it up to the card's limits —
> whether to trust it is your decision.

On `/allow`, where the URL arrived through a link the owner did not type, the notice is preceded
by one more sentence: "This request came from a link. Make sure it is a service your agent is
meant to use." The primary button on `/allow` and the card screen is labelled with the resolved
host, e.g. **Allow demo.rail402.dev**, so the owner reads what they are approving; the wizard's
button stays "Add to list" because nothing is signed there, and the confirm step repeats the
notice once above the merchant list. The seed list ("try one of these") shows the same notice in
one shorter line: "Examples, not recommendations."

Pressing the primary button on the **card screen** runs the existing `useCardOp("merchant-add")`
with the resolved `payTo`; on success the resolved name is saved (see 3) and the resolver returns
to idle. In the **wizard** it appends `payTo` to `draft.merchants` (validation unchanged; the
32 cap and dedupe apply) and records the name in the draft so the confirm step can show it. The
wizard's existing `add_merchant` loop after `create_card` is unchanged; it saves names after each
confirmed transaction.

Keyboard and a11y: Enter in the field triggers "Look up"; the resolved preview is a `role="group"`
with an `aria-label` naming the service; errors use the existing `Field` error slot (`aria-live`).

### 3. Merchant names (per device)

`lib/prefs.ts` gains `getMerchantLabels(owner, card): Record<string, {name: string; url: string}>`,
`setMerchantLabel(owner, card, payTo, label)`, `removeMerchantLabel(...)`. Stored in
`localStorage` next to the existing per-owner prefs; every read wrapped in try/catch like today.

`MerchantsSection` renders the name on the first line and the shortened address on the second when
a label exists; otherwise the address only, as today. The confirm step of the wizard does the same.
Removing a merchant removes its label. Labels are treated as untrusted text (they came from a
third-party header): plain text rendering only.

### 4. Flow 1 — the denial link

`packages/x402-client`:

- `CardPolicyDenied` gains optional `merchant?: { payTo: string; url?: string; amount?: string;
  network?: string }` populated for `not_allowlisted` wherever the terms are known (precheck,
  simulate, verify; settle when the response carried them). *(Author's call after review:)* `url`
  is the **request URL the agent called** (origin + path only — the query string and fragment are
  stripped, because agents sometimes carry API keys in query params and the link would otherwise
  leak them into the resolver and the owner's browser history), known only inside
  `createMooringFetch`; `createMooringClient` used standalone sets `merchant` without `url`, and
  the link is added to the message only when `url` is present. The plumbing lives in the fetch
  wrapper (it has the request), passed down to the hooks via the per-call client it already builds.
- New exported helper `allowMerchantUrl(appBaseUrl, card, serviceUrl): string` →
  `${appBaseUrl}/allow?card=<C…>&url=<encoded service URL>`. The error **message** for
  `not_allowlisted` ends with ` — allow it: <that URL>` using the default base
  `https://app.mooring.live`, overridable via `MooringClientOptions.appUrl`. Only the service URL
  travels in the link; never the address (anti-goal).
- Version bump to `0.2.0` (additive); CLI prints the link on its own line after
  `Denied (not_allowlisted) at <stage>`, depends on client `0.2.0`, and its own `.version()`
  becomes `0.2.0`. *(Author's call after review:)* the deliverable is "done" with both bumps in the
  repo, tests green and the web app deployed (Vercel builds the client from the workspace, so the
  app needs no npm release). Publishing `0.2.0` of both packages is a separate owner step right
  after merge (interactive `npm publish` for the OTP, client first, then CLI), exactly like 0.1.0.

`apps/web`:

- New route `/allow` (`app/allow/page.tsx`). Query: `card` (required, must be a valid `C…`),
  `url` (optional). The existing `NetworkGuard` already renders the connect screen inline on every
  non-`/` route, so no return-to parameter is needed. It verifies the connected wallet **owns** the
  card (reads `info().owner`); otherwise it refuses, showing the owner's shortened address. It
  renders the card's summary header and `MerchantResolver` with `url` prefilled and resolution
  started automatically. After a confirmed `add_merchant` it calls the idempotent `addCard` (so a
  legacy random-salt card appears on `/cards` too) and links to `/cards` with that card selected.
- Unknown or foreign `card` → a plain error state with a link to `/cards`.

### 5. Seed list

A tiny constant in `lib/merchants/seed.ts`: `{ name, url, note }[]` per network, read by the
resolver UI only. Testnet: Rail402 demo weather. It is not a directory; it exists so a first-time
owner has something to click.

## What happens when…

| Situation | Result |
|---|---|
| Service only answers 402 on POST | GET → not 402 → POST retry → resolved |
| Service wants `stellar:pubnet` USDC | `no_match`, UI: "This service accepts Stellar mainnet USDC; this card holds testnet USDC." |
| Service lists both testnet and pubnet | one match → resolved (the other entries ignored) |
| Two testnet USDC entries with different `payTo` | `ambiguous`, both shown, add-by-address offered |
| URL is `http://localhost:3001/weather` without `MOORING_RESOLVER_ALLOW_LOCAL` | `blocked_url` |
| Redirect to a private IP | `blocked_url` on that hop |
| Service down / DNS fails / timeout | `unreachable` |
| Merchant already allowed | preview shows "Already allowed", no transaction |
| Card is frozen / cancelled | resolver works; the add button obeys the existing write gate (disabled with the same reason) |
| Wallet does not own the card on `/allow` | refused with the owner's shortened address |
| Resolver route rate-limited | HTTP 429 → UI `failed` with "Too many lookups, try again in a minute." |

## Testing

- Unit: resolver route (all branches, mocked fetch and DNS; runs under a per-file `node`
  environment since vitest defaults to jsdom), terms normalisation v2 header / v1 body, prefs
  labels, `allowMerchantUrl` (query stripped), `CardPolicyDenied.merchant`, CLI output line.
- Component: `MerchantResolver` states, "Already allowed", the responsibility notice present in
  the resolved state on both screens and the extra sentence on `/allow`, host-labelled button,
  wizard draft integration, names in `MerchantsSection`.
- e2e (mock wallet, stubbed route): wizard adds a merchant by URL and creates the card; card screen
  adds by URL; `/allow?card&url` end to end; `no_match` message shown; address fallback still works.
- Manual on testnet before merge: resolve and allow `https://demo.rail402.dev/weather` on a fresh
  card, then `mooring pay` it; run `mooring pay` against a non-allowlisted seller and follow the
  printed link.

## Left to the builder

- Exact copy of error sentences (keep them one sentence, no jargon).
- Layout details of the preview card within the existing design tokens.
- Whether the rate limiter is a small inline module or a dependency (prefer inline, ~30 lines).
- `@x402/*` may expose a header decoder; use it if its types fit, otherwise decode locally (the
  format is base64 JSON).

## Review round (2026-10-31)

A builder check raised four questions; none changed what gets built, so all four were settled by
the author and are marked *(Author's call after review)* above: v1 body parsing (supported, capped
read), the loopback gate (`MOORING_RESOLVER_ALLOW_LOCAL`, server-side only), which URL the denial
link carries (the agent's request URL, query stripped, optional), and release sequencing (bumps in
repo are the deliverable; npm publish is the owner's step after merge).
