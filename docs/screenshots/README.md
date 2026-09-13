# Screenshots

Evidence images for the manual testnet checklist in [`../web-app.md`](../web-app.md). They are
captured by the repository owner while running the checklist with the real Freighter extension
against the testnet deployment; **none of them exist yet.**

Expected files, in checklist order:

| File | Step |
|---|---|
| `01-connect.png` | Freighter connected, wallet badge on testnet |
| `02-wizard-policy.png` | Wizard step 1, label `inference-agent-2` and the live preview |
| `03-wizard-agent.png` | Wizard step 2, agent public key and merchants |
| `04-card-created.png` | New card selected on `/cards` after `create_card` |
| `05-merchant-added.png` | `add_merchant` confirmed for the wizard's merchant |
| `06-funded.png` | Card funded with 1 USDC |
| `07-policy-edited.png` | `set_policy` confirmed, new budget on the card |
| `08-merchant-add.png` | Second merchant added |
| `09-merchant-remove.png` | That merchant removed |
| `10-signer-rotated.png` | `set_signer` confirmed |
| `11-frozen.png` | Frozen card face |
| `12-unfrozen.png` | Active again |
| `13-budget-moved.png` | Budget bar after a `mooring pay` payment |
| `14-withdrawn.png` | 0.5 USDC withdrawn |
| `15-cancelled.png` | Cancelled card, balance swept to the owner |
| `16-denied-after-cancel.png` | Optional: payment denied after cancel |

PNG, cropped to the browser viewport, no wallet secrets or seed phrases visible.
