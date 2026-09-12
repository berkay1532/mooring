#!/usr/bin/env bash
# Moves USDC from the funder account into the card (SAC transfer to a C address).
set -euo pipefail
cd "$(dirname "$0")/../.."
NETWORK=testnet
CARD=$(jq -r .card deployed.testnet.json)
TOKEN=$(jq -r .token deployed.testnet.json)
AMOUNT=${1:-200000000}   # default 20 USDC

stellar contract invoke --source mooring-funder --network $NETWORK --id "$TOKEN" -- \
  transfer --from mooring-funder --to "$CARD" --amount "$AMOUNT"

# CLI 26.1.0 requires --source-account even for read-only invocations
# (the brief's plain `stellar contract invoke ... -- balance` omitted it).
stellar contract invoke --source mooring-funder --network $NETWORK --id "$CARD" -- balance
