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
```

`mooring create` deploys a card through the Mooring factory, signed by the **owner** key in
`OWNER_SECRET` (`--owner-secret-env` to read another variable). It picks the next unused deployer
salt for that owner — the same derivation the web app uses — so the card shows up at
https://app.mooring.live/cards for that owner on any device, with no import step. Options:
`--max-per-tx` (default: the budget), `--expiry` (`+30d` default, `+12h`, or an ISO date),
`--salt` to pin an index, `--factory`/`--token` to target another deployment, `--json` for
machine-readable output (card address, salt index, tx hash). Fund the card by sending USDC to its
address; the allowlist is managed in the app.

`mooring pay` prints the HTTP status, the settlement transaction hash and the response body.
A refusal by the card's policy prints `Denied (<reason>) at <stage>` and exits with code **2**,
so a script can tell a refused payment from a broken one. `--no-precheck` skips the local policy
mirror (the card still enforces on-chain); `--agent-secret-env <NAME>` reads the secret from a
different variable; `--network` and `--rpc` select the network.

Cards are managed by their owner in the web app at https://app.mooring.live (`mooring create` makes one from a script).
Integration guide, error semantics and facilitator constraints:
[`docs/x402-integration.md`](https://github.com/berkay1532/mooring/blob/main/docs/x402-integration.md).
