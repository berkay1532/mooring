# Mooring example seller

`apps/seller` is Mooring's hosted example seller, served at `https://api.mooring.live`. It sells
one small paid resource, a public-domain quote, over two protocols so that a Mooring card can be
exercised end to end against a real service:

- `GET /quote` is paid over **x402** and settled by the OpenZeppelin Channels facilitator.
- `GET /quote/mpp` is paid over **MPP charge**: the seller itself verifies and broadcasts the
  payer's transaction.

It exists for two reasons. It is the seller that `npx create-mooring-agent` points a fresh agent
at, and it is the target of the week-3 evidence (settled card payments over both protocols,
including a denial).

Why a custom MPP verifier: stock `@stellar/mpp` servers reject contract payers, and a Mooring card
is a Soroban custom account (`C...`). This seller therefore carries a card-aware charge verifier
(`apps/seller/src/mpp-card-charge.ts`). An upstream PR to the SDK is being prepared; see
[`docs/upstream/stellar-mpp-sdk-contract-payers.md`](upstream/stellar-mpp-sdk-contract-payers.md).

## Routes and payment terms

Network `stellar:testnet`. Price per paid request: **0.001 USDC = `10000` base units** (7
decimals). Asset: the USDC SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. Pay-to:
the account in `SELLER_PAY_TO`.

| Route | Protocol | Unpaid response | Paid response |
|---|---|---|---|
| `GET /` | none | 200 JSON document: `name`, `network`, `payTo`, `resources` (path, protocol, amount, asset), `docs` | |
| `GET /health` | none | 200 `{"ok":true}` | |
| `GET /quote` | x402 (`exact`) | 402 with a `PAYMENT-REQUIRED` header | 200 `{quote, author, paidWith:"x402", ts}` |
| `GET /quote/mpp` | MPP charge | 402 with `WWW-Authenticate: Payment ...` | 200 `{quote, author, paidWith:"mpp", ts}` |

The quote is one of ten public-domain lines, chosen by `Date.now() % 10`.

## The MPP verifier

The card-aware verifier accepts a payment only when all of the following hold:

1. **Pull mode only.** The credential must carry a signed transaction; the seller broadcasts the
   envelope it verified. Push-mode credentials are refused.
2. **No fee sponsoring.** The envelope source is the payer's own fee account (an ordinary `G...`
   account, not the seller and not the all-zeros placeholder). Fee-bump envelopes are refused.
3. **The DID names the payer.** The credential's `source` must be a
   `did:pkh:stellar:<network>:<address>` on this network, and that address must be the `from` of
   the transfer.
4. **Exactly one `transfer`.** The envelope has one `invokeHostFunction` operation that is
   `USDC.transfer(from, payTo, amount)` with exactly the requested currency, recipient and amount.
   Every auth entry is an address credential with no sub-invocations; one by `from` covers exactly
   this transfer.
5. **Bounded auth window.** Each auth entry expires after the latest ledger and at most **120
   ledgers** (about 10 minutes) ahead of it. Signatures of `G...` authorizers are checked locally.
6. **Enforcing simulation, then broadcast.** The envelope is simulated in enforce mode, so a
   card's `__check_auth` runs and its refusal (budget, allowlist, expiry, frozen) surfaces as the
   402 reason. Only then is it broadcast, and the seller waits for the transaction to reach
   `SUCCESS` before the resource is returned. A failed or unconfirmed transaction is never paid for
   with a response.

## Configuration

| Variable | Meaning | Example shape | Required | Default |
|---|---|---|---|---|
| `STELLAR_NETWORK` | CAIP-2 network | `stellar:testnet` | no | `stellar:testnet` (`stellar:pubnet` accepted, not used yet) |
| `SELLER_PAY_TO` | Account (`G...`) or contract (`C...`) paid for both routes | `G...` (56 chars) | yes | none |
| `OZ_API_KEY` | API key for the OZ Channels facilitator (generate at https://channels.openzeppelin.com/testnet/gen) | opaque string | yes | none |
| `FACILITATOR_URL` | x402 facilitator base URL | `https://...` | no on testnet, yes on pubnet | `https://channels.openzeppelin.com/x402/testnet` |
| `MPP_SECRET_KEY` | HMAC key binding MPP challenges to their contents; at least 32 characters, random | 64 hex chars | yes | none |
| `SOROBAN_RPC_URL` | Soroban RPC used by the MPP charge to simulate and broadcast | `https://...` | no | the `@x402/stellar` default for the network |

Never commit real values. `apps/seller/.env.example` lists the names with empty values.

## Run locally

```bash
cp apps/seller/.env.example apps/seller/.env   # then fill it in
npm run dev -w @mooring/seller
```

The dev server listens on port **3002** (override with `PORT`) and reads `apps/seller/.env` when
present. Then `curl -i http://localhost:3002/health`.

## Deploy to Vercel (owner checklist)

1. In Vercel, add a new project from the GitHub repository `berkay1532/mooring`.
2. Set **Root Directory** to `apps/seller`.
3. Set **Framework Preset** to "Other". The build and install commands come from
   `apps/seller/vercel.json` (they run from the repository root and build the client package
   first); a rewrite sends every path to the single function `api/index.ts`.
4. Set the Node.js version to 20 or newer (Project Settings, General).
5. Add the environment variables (Production, and Preview if wanted): `SELLER_PAY_TO`,
   `OZ_API_KEY`, `MPP_SECRET_KEY`, and optionally `STELLAR_NETWORK`, `FACILITATOR_URL`,
   `SOROBAN_RPC_URL`.
6. Deploy.
7. Under Project Settings, Domains, add `api.mooring.live`.
8. At the DNS provider, create a `CNAME` record: `api` -> `cname.vercel-dns.com`.
9. Wait for Vercel to issue the certificate (the domain turns valid), then run the verification
   below.

## Verify

```bash
curl -i https://api.mooring.live/health        # 200  {"ok":true}
curl -i https://api.mooring.live/quote         # 402, with a PAYMENT-REQUIRED header
curl -i https://api.mooring.live/quote/mpp     # 402, with WWW-Authenticate: Payment ...
```

## Pay it from a card

With the `mooring` CLI and a funded card whose allowlist includes the seller's `payTo`:

```bash
mooring pay https://api.mooring.live/quote     --card C...   # x402
mooring pay https://api.mooring.live/quote/mpp --card C...   # MPP charge
```

Both return the quote and the transaction hash. If the card refuses (not allowlisted, over
budget, expired, frozen), the CLI prints the typed denial.

## Limitations

- **Replay scope is one instance.** The MPP replay store is `Store.memory()`: claimed challenge
  ids and transaction hashes live per process, so a second serverless instance does not see them.
  Even then, a re-sent transaction is refused: the transaction-hash claim stops a repeat on the
  same instance, and the seller sends only when the RPC answers `PENDING`, so the network rejects a
  duplicate sequence number or an already-used auth nonce.
- **No fee sponsoring.** The payer's agent account pays the network fee on MPP charge.
- **Testnet only.** Mainnet follows an audit.
