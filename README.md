# Mooring

**Programmable spending allowances for AI agents on Stellar.**

Mooring lets you delegate spending to an autonomous agent with hard, on-chain
limits. Each spending-policy **card** is a native Soroban custom account
(`__check_auth`) that holds USDC and enforces policy at the authorization
boundary — a periodic budget, a merchant allowlist, and an expiry — so an agent
can pay for [x402](https://x402.org)-protected services **per request** while
over-budget, unauthorized, or expired attempts are rejected on-chain.

Non-custodial throughout: funds live in the card under the owner's control; no
third party ever holds them.

## Why Stellar

- **Native account abstraction.** Soroban custom accounts put the spending
  policy *inside* the authorization path — no separate allowance ledger to keep
  in sync.
- **Contract-native authorization.** A contract can authorize a specific call
  natively, so an agent-signed payment is gated by the card's policy at
  settlement.
- **Sub-cent fees.** Per-request micropayments are economically viable.
- **USDC first-class** via the Stellar Asset Contract; optional passkey
  (secp256r1) signers for real card UX.

## Status

Early development. Scope, architecture, and milestones are being defined.

## License

Apache-2.0 (to be added).
