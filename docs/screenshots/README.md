# Screenshots

Evidence images for the manual testnet checklist in [`../web-app.md`](../web-app.md), captured by
the repository owner on 2026-09-25 while running the checklist with the real Freighter extension
against a local `next dev` on testnet. JPEG, resized to 1600 px wide. The transaction hashes in
the checklist are the primary evidence; these images show the app at the corresponding moments.

| File | What it shows |
|---|---|
| `01-connect.jpg` | Header with the connected wallet badge (`GCJJ…KKBD · testnet`), on the wizard route |
| `02-wizard-policy.jpg` | Wizard step 1 (policy) with the live preview card |
| `03-wizard-agent.jpg` | Wizard step 2 (agent key and merchants), taken on a later card (`inference-agent-3`) |
| `04-card-created.jpg` | My cards after the run: the legacy card selected, `inference-agent-2` (cancelled) beside it |
| `05-merchant-added.jpg` | Merchants section, `1 / 32` |
| `06-funded.jpg` | Card face at carousel size (legacy card, 11.30 USDC) |
| `07-policy-edited.jpg` | Policy panel (legacy card) |
| `11-frozen.jpg` | Frozen card face (legacy card) |
| `15-cancelled.jpg` | `inference-agent-2` cancelled, balance 0.00 |

Not captured: 08 (second merchant added), 09 (merchant removed), 10 (signer rotated),
12 (unfrozen), 13 (budget after `mooring pay` — a 0.001 USDC payment is below the two-decimal
display), 14 (withdrawn), 16 (denied after cancel — CLI output only).
