# create-mooring-agent

[![npm](https://img.shields.io/npm/v/create-mooring-agent)](https://www.npmjs.com/package/create-mooring-agent)

Scaffold a small TypeScript agent that pays a service per request from a
[Mooring](https://mooring.live) spending card on Stellar. The card is a Soroban custom account
that holds USDC and enforces a periodic budget, a merchant allowlist and an expiry on-chain. The
agent pays through [`@mooring-live/x402-client`](https://www.npmjs.com/package/@mooring-live/x402-client)'s
`pay()`, which handles both x402 and MPP charge. It also applies local caps before signing and
keeps a signed receipt ledger.

```sh
npx create-mooring-agent my-agent [--service https://api.mooring.live/quote] [--network stellar:testnet]
```

The default service is Mooring's hosted example seller (`https://api.mooring.live/quote`, 0.001 USDC
over x402). `--network` accepts `stellar:testnet` only in this release. The target directory must
be empty or missing.

It writes `package.json`, `.env.example`, `.gitignore`, `README.md`, `tsconfig.json`, `src/agent.ts`
(`npm run pay`), `src/status.ts` (`npm run status`) and `src/config.ts`.

## Next steps

1. Create and fund a card at https://app.mooring.live and generate an agent key there (or `mooring keygen`); register the key as the card's signer.
2. Copy `.env.example` to `.env` and fill `MOORING_CARD` and `AGENT_SECRET`; fund the agent account with a little XLM on testnet (friendbot) for MPP fees.
3. `npm install && npm run pay`

## What `npm run pay` prints

On success:

```
Paid 0.001 USDC to G… via x402
tx <hash> — https://stellar.expert/explorer/testnet/tx/<hash>
Remaining this period: 4.999 USDC
Receipt <id> → ~/.mooring/receipts.jsonl
```

followed by the response body. Every refusal exits with code 1:

- `Refused before signing: <reason>`: a local cap or the stop switch said no, and nothing was signed.
- `The card refused the payment: <reason>`: the card's policy said no. For `not_allowlisted` the
  agent also prints an `Allow it:` link to the app. For `insufficient_balance` it prints
  `Fund the card at https://app.mooring.live (card <address>)`.
- `Payment failed (<kind>): <detail>`: any other failure. An unfunded agent account also gets a
  friendbot link.

## Guard rails and receipts

The card's limits are enforced on-chain no matter what the agent does. Before signing, the agent
also checks local caps in decimal USDC. They come from `MOORING_DAILY_CAP`, `MOORING_TOTAL_CAP` and
`MOORING_MAX_PER_TX` in `.env`, or from a `mooring.guard.json` next to `package.json`
(`{ "dailyCap": "0.05", "maxPerTx": "0.01" }`). If both are set, the file wins key by key. The template ships with a 1 USDC daily cap (`MOORING_DAILY_CAP=1` in `.env.example`) that you can change.

The guard state, the stop switch and the receipt ledger live in the state directory
(`MOORING_HOME`, default `~/.mooring`). The [`mooring` CLI](https://www.npmjs.com/package/@mooring-live/cli)
shares this directory: `mooring stop` / `mooring resume` halt and resume every agent that uses it.
Every payment attempt is appended to `receipts.jsonl` there as an agent-signed receipt, and
`mooring receipts` exports and verifies them.

Pay something else: pick a service in Browse services (app.mooring.live) and set `MOORING_SERVICE`.

## Learn more

- [x402 integration guide](https://github.com/berkay1532/mooring/blob/main/docs/x402-integration.md)
- [The hosted example seller](https://github.com/berkay1532/mooring/blob/main/docs/seller.md)

## License

Apache-2.0
