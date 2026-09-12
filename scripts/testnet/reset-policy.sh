#!/usr/bin/env bash
# Owner: restore the live card's policy to 50 USDC/day, 10 USDC max per payment, expiry +30 days.
#
# The card's live policy drifts as tests exercise it (D1's race test left it at
# 10 USDC/day). Run this before an end-to-end run so the card has budget again.
set -euo pipefail
cd "$(dirname "$0")/../.."

CARD=$(jq -r .card deployed.testnet.json)
EXPIRY=$(( $(date +%s) + 30*86400 ))

echo "Card: $CARD"
echo "Policy: 500000000 (50 USDC) / 86400s, max_per_tx 100000000 (10 USDC), expiry $EXPIRY"

stellar contract invoke --source-account mooring-owner --network testnet --id "$CARD" -- set_policy \
  --policy "{\"period_amount\":\"500000000\",\"period_duration\":86400,\"max_per_tx\":\"100000000\",\"expiry\":$EXPIRY}"

stellar contract invoke --source-account mooring-owner --network testnet --id "$CARD" -- info
