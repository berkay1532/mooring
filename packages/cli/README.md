# @mooring/cli

Command-line companion to [`@mooring/x402-client`](https://www.npmjs.com/package/@mooring/x402-client):
generate an agent key, inspect a Mooring spending card, and pay an [x402](https://x402.org)-protected
API from it. A card is a Soroban custom account on Stellar that holds USDC and enforces a periodic
budget, a per-payment cap, a merchant allowlist and an expiry inside its authorization path.

Apache-2.0. **Stellar testnet only** — not audited, not on mainnet.

```sh
npm i -g @mooring/cli

mooring keygen --hex                        # a new agent keypair (--hex prints the signer bytes)
mooring status --card C… --json             # label, policy, period, remaining budget, allowlist
AGENT_SECRET=S… mooring pay https://api.example.com/weather --card C…
```

`mooring pay` prints the HTTP status, the settlement transaction hash and the response body.
A refusal by the card's policy prints `Denied (<reason>) at <stage>` and exits with code **2**,
so a script can tell a refused payment from a broken one. `--no-precheck` skips the local policy
mirror (the card still enforces on-chain); `--agent-secret-env <NAME>` reads the secret from a
different variable; `--network` and `--rpc` select the network.

Cards are created and managed by their owner in the web app at https://app.mooring.live.
Integration guide, error semantics and facilitator constraints:
[`docs/x402-integration.md`](https://github.com/berkay1532/mooring/blob/main/docs/x402-integration.md).
