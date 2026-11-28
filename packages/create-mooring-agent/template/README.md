# __NAME__

An agent that pays `__SERVICE__` per request from a [Mooring](https://mooring.live) spending
card on `__NETWORK__`. The card is a Soroban custom account that holds USDC and enforces its budget,
merchant allowlist and expiry on-chain; this agent signs as the card's agent key through
[`@mooring-live/x402-client`](https://www.npmjs.com/package/@mooring-live/x402-client)'s `pay()`,
which speaks both x402 and MPP charge.

## Next steps

1. Create and fund a card at https://app.mooring.live and generate an agent key there (or `mooring keygen`); register the key as the card's signer.
2. Copy `.env.example` to `.env` and fill `MOORING_CARD` and `AGENT_SECRET`; fund the agent account with a little XLM on testnet (friendbot) for MPP fees.
3. `npm install && npm run pay`

## What `npm run pay` does

`src/agent.ts` requests `MOORING_SERVICE`. When the seller answers 402, `pay()` checks the local
guard, signs the card's USDC transfer with the agent key and retries, then prints:

```
Paid 0.001 USDC to G… via x402
tx <hash> — https://stellar.expert/explorer/testnet/tx/<hash>
Remaining this period: 4.999 USDC
Receipt <id> → ~/.mooring/receipts.jsonl
```

followed by the response body. Every refusal exits with code 1:

- `Refused before signing: <reason>` — a local cap or the stop switch said no; nothing was signed.
- `The card refused the payment: <reason>` — the card's policy said no. For `not_allowlisted` the
  agent prints an `Allow it:` link that adds the merchant in the app; for `insufficient_balance`,
  where to fund the card.
- `Payment failed (<kind>): <detail>` — anything else (an unfunded agent account prints a
  friendbot link).

`npm run status` prints the card's state, balance, budget and allowlist.

## Guard rails

The card's limits are enforced on-chain whatever the agent does. On top of them, the agent applies
local caps before it signs, shared with the `mooring` CLI through the state directory
(`MOORING_HOME`, default `~/.mooring`):

- `MOORING_DAILY_CAP`, `MOORING_TOTAL_CAP`, `MOORING_MAX_PER_TX` in `.env` (decimal USDC), or a
  `mooring.guard.json` next to `package.json`: `{ "dailyCap": "0.05", "maxPerTx": "0.01" }`.
- `mooring stop` / `mooring resume` (from `@mooring-live/cli`) flip the stop switch for every agent
  using the same state directory.

Each attempt is recorded as an agent-signed receipt in `receipts.jsonl` under the state directory;
`mooring receipts` exports and verifies them.

## Configuration

| Variable | |
| --- | --- |
| `MOORING_CARD` | the card (C…) |
| `AGENT_SECRET` | the card's agent key (S…); never commit it |
| `MOORING_SERVICE` | the paid URL (default `__SERVICE__`) |
| `MOORING_NETWORK` | `stellar:testnet` (default) or `stellar:pubnet` |
| `MOORING_RPC_URL` | optional Soroban RPC; required on `stellar:pubnet` |
| `MOORING_HOME` | optional state directory (default `~/.mooring`) |
