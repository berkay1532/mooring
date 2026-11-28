# @mooring-live/cli

[![npm](https://img.shields.io/npm/v/%40mooring-live%2Fcli)](https://www.npmjs.com/package/@mooring-live/cli)

Command-line companion to [`@mooring-live/x402-client`](https://www.npmjs.com/package/@mooring-live/x402-client):
generate an agent key, inspect a Mooring spending card, and pay an [x402](https://x402.org)-protected
API from it. A card is a Soroban custom account on Stellar that holds USDC and enforces a periodic
budget, a per-payment cap, a merchant allowlist and an expiry inside its authorization path.

Apache-2.0. **Stellar testnet only** — not audited, not on mainnet.

```sh
npm i -g @mooring-live/cli

mooring keygen --hex                        # a new agent keypair (--hex prints the signer bytes)
OWNER_SECRET=S… mooring create --label ops-agent --signer G… --budget 5 --period 1d
mooring status --card C… --json             # label, policy, period, remaining budget, allowlist
AGENT_SECRET=S… mooring pay https://api.example.com/weather --card C…
mooring guard --card C…                     # local spend counters and caps
mooring stop --reason "investigating"       # no payment is signed until `mooring resume`
mooring receipts export --csv               # the signed receipt ledger
```

`mooring create` deploys a card through the Mooring factory, signed by the **owner** key in
`OWNER_SECRET` (`--owner-secret-env` to read another variable). It picks the next unused deployer
salt for that owner — the same derivation the web app uses — so the card shows up at
https://app.mooring.live/cards for that owner on any device, with no import step. Options:
`--max-per-tx` (default: the budget), `--expiry` (`+30d` default, `+12h`, or an ISO date),
`--salt` to pin an index, `--factory`/`--token` to target another deployment, `--json` for
machine-readable output (card address, salt index, tx hash). Fund the card by sending USDC to its
address; the allowlist is managed in the app.

`mooring pay <url> --card C…` pays an x402 **or** MPP charge seller (one `pay()`), inside the local
guard's caps. On success it prints:

```
HTTP 200
Protocol: x402
Settlement: <tx hash> (stellar:testnet)
Receipt: <id>
<response body>
```

`--json` prints `{ protocol, settlement, receipt }` instead of the body. A refusal by the card's
policy prints `Denied (<reason>) at <stage>` (with an `Allow it:` link for an unlisted merchant)
and exits with code **2**, so a script can tell a refused payment from a broken one. A refusal by
the local guard prints, before anything is signed:

```
refused before signing: <reason> (<attempted> USDC attempted, limit <limit>)
```

and also exits **2**. An MPP charge the seller does not sponsor is paid in network fees by the
agent account, so that account must exist and hold XLM (testnet: friendbot). When it does not,
`mooring pay` prints the `agent_unfunded: …` detail and
`Fund the agent account with XLM (testnet: https://friendbot.stellar.org?addr=<G…>)`, and exits
**1**. `--no-precheck` skips the local policy mirror (the card still enforces
on-chain); `--agent-secret-env <NAME>` reads the secret from a different variable; `--network` and
`--rpc` select the network.

Local caps, in decimal USDC: `--daily-cap`, `--total-cap`, `--max-per-tx`. Precedence: flags, then
`mooring.guard.json` in the working directory (`{ "dailyCap": "5", "totalCap": "50", "maxPerTx": "0.5" }`),
then `MOORING_DAILY_CAP`, `MOORING_TOTAL_CAP`, `MOORING_MAX_PER_TX`. `--no-guard` pays without the
guard (no caps, no stop switch); receipts are still recorded.

Guard and receipts commands (state lives in `~/.mooring`; `MOORING_HOME` overrides it):

- `mooring stop [--reason <text>] [--card C…]` stops every payment, or one card's, by writing the
  `stop` file. `mooring resume [--card C…]` lifts it.
- `mooring guard --card C… [--json]` prints today's and total spend, open reservations, caps and
  the stop state.
- `mooring receipts export --csv|--json [--since <iso>] [--card C…]` writes the ledger
  (`~/.mooring/receipts.jsonl`) to stdout.
- `mooring receipts verify [<file>]` checks every receipt's agent signature (default: the ledger);
  it prints `verified <n> receipts`, or `bad signature: <id>` and exits 1.

Cards are managed by their owner in the web app at https://app.mooring.live (`mooring create` makes one from a script).
Integration guide, error semantics and facilitator constraints:
[`docs/x402-integration.md`](https://github.com/berkay1532/mooring/blob/main/docs/x402-integration.md).
