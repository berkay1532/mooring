#!/usr/bin/env bash
# Moves testnet funds from the previous card into the new one:
#   1. ensure mooring-owner holds a USDC trustline (cancel/withdraw sweep to the owner)
#   2. cancel the OLD card (owner op) → its balance lands in the owner's account
#   3. transfer that USDC from the owner into the NEW card
# Usage: scripts/testnet/migrate-card.sh <OLD_CARD_ADDRESS>   (new card read from deployed.testnet.json)
set -euo pipefail
cd "$(dirname "$0")/../.."
OLD=${1:?old card address}
NEW=$(jq -r .card deployed.testnet.json)
TOKEN=$(jq -r .token deployed.testnet.json)
USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
OWNER=$(stellar keys address mooring-owner)

if [[ "$OLD" == "$NEW" ]]; then
  echo "old and new card are the same address ($OLD) -- nothing to migrate." >&2
  exit 1
fi

echo "old card: $OLD"
echo "new card: $NEW"
echo "owner:    $OWNER"

# The owner receives the cancelled card's whole balance as a classic USDC
# payment, which needs a trustline first. Idempotent: only submit
# change-trust when the trustline is actually missing.
if ! curl -sf "https://horizon-testnet.stellar.org/accounts/$OWNER" | jq -e --arg iss "$USDC_ISSUER" '.balances[] | select(.asset_code=="USDC" and .asset_issuer==$iss)' >/dev/null; then
  echo "owner has no USDC trustline; adding it..."
  stellar tx new change-trust --source mooring-owner --network testnet --line "USDC:$USDC_ISSUER"
else
  echo "owner already holds a USDC trustline."
fi

OLD_BAL=$(stellar contract invoke --source-account mooring-owner --network testnet --id "$OLD" -- balance | tr -d '"')
echo "old card balance: $OLD_BAL"
if [[ "$OLD_BAL" == "0" ]]; then
  echo "old card already empty; skipping cancel + transfer." >&2
  exit 0
fi

stellar contract invoke --source-account mooring-owner --network testnet --id "$OLD" -- cancel
stellar contract invoke --source-account mooring-owner --network testnet --id "$TOKEN" -- \
  transfer --from mooring-owner --to "$NEW" --amount "$OLD_BAL"
echo "new card balance:"
stellar contract invoke --source-account mooring-owner --network testnet --id "$NEW" -- balance
