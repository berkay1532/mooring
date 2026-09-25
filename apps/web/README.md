# @mooring/web

The owner-facing Mooring web app: connect Freighter, create and fund spending cards, watch each
card's budget live, and run every owner operation (fund, freeze, unfreeze, withdraw, cancel,
rename, edit policy, add/remove merchants, rotate the agent signer) on Stellar testnet.

Next.js 15 (App Router) + Tailwind 4, talking to the card contract and factory directly over
Soroban RPC. No backend, no server-side keys. The app never generates or stores an agent secret —
the owner pastes the agent's **public** key.

## Setup

```sh
npm ci                                                           # from the repo root
npm run build -w @mooring/contracts-ts -w @mooring/x402-client   # workspace deps
cp apps/web/.env.example apps/web/.env.local
npm run dev -w @mooring/web                                      # http://localhost:3000
```

`.env.example` holds the testnet configuration (network, RPC, passphrase, factory, USDC SAC,
docs link). `NEXT_PUBLIC_WALLET=mock` swaps in an in-memory wallet for tests and unlocks
`/dev/gallery`; never set it on a deployment.

## Scripts

| Command (from the repo root) | What it does |
|---|---|
| `npm run dev -w @mooring/web` | dev server |
| `npm run typecheck -w @mooring/web` | `tsc --noEmit` |
| `npm test -w @mooring/web` | unit + component tests (vitest, jsdom) |
| `npm run build:web -w @mooring/web` | production build (needs the env vars) |
| `npm run e2e -w @mooring/web` | Playwright flows (mock wallet, intercepted RPC) |

None of them touches testnet. All of them run in the `web` job of `.github/workflows/ci.yml`.

## Documentation

[`docs/web-app.md`](../../docs/web-app.md) — screens, architecture, configuration, the Vercel
deployment steps, and the manual testnet checklist.
