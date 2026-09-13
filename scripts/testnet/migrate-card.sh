#!/usr/bin/env bash
# Moves testnet funds from the previous card into the new one:
#   1. read the OLD card's info() (label/state/balance) and require explicit
#      confirmation (MIGRATE_YES=1) before any write
#   2. ensure mooring-owner holds a USDC trustline (needed to receive the
#      swept balance)
#   3. sweep the OLD card's balance to the owner -- `cancel` if it is still
#      Active/Frozen (state 0/1), `withdraw` if it is already Cancelled
#      (state 2) with a non-zero balance (i.e. a partial earlier run: the
#      card was cancelled but the transfer into the new card never ran)
#   4. transfer that USDC from the owner into the NEW card
#
# Safety: nothing is written until the OLD card's current info() has been
# printed and MIGRATE_YES=1 is set. A balance of 0 is not treated as
# "nothing to do" -- it can also mean an earlier run already swept the
# balance to the owner but the final transfer never happened, so that case
# prints the owner's Horizon USDC balance and the exact manual command to
# finish the job by hand, then exits 1 (not 0) so it is never mistaken for
# a completed migration.
#
# Usage: MIGRATE_YES=1 scripts/testnet/migrate-card.sh <OLD_CARD_ADDRESS>
#        (new card read from deployed.testnet.json)
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

INFO=$(stellar contract invoke --source-account mooring-owner --network testnet --id "$OLD" -- info)
OLD_LABEL=$(jq -r '.label // "(no label field -- pre-label card)"' <<<"$INFO")
OLD_STATE=$(jq -r '.state' <<<"$INFO")
OLD_BAL=$(jq -r '.balance' <<<"$INFO")

echo "old card label:   $OLD_LABEL"
echo "old card state:   $OLD_STATE (0=Active, 1=Frozen, 2=Cancelled)"
echo "old card balance: $OLD_BAL"

if [[ "$OLD_BAL" == "0" ]]; then
  echo "" >&2
  echo "old card balance is already 0 -- refusing to proceed automatically." >&2
  echo "this can mean the card was never funded, OR that an earlier run" >&2
  echo "already cancelled/withdrew it but the transfer into the new card" >&2
  echo "never happened (a partial run). Check whether the owner is holding" >&2
  echo "the funds and, if so, finish the migration by hand:" >&2
  OWNER_USDC=$(curl -sf "https://horizon-testnet.stellar.org/accounts/$OWNER" \
    | jq -r --arg iss "$USDC_ISSUER" '.balances[]? | select(.asset_code=="USDC" and .asset_issuer==$iss) | .balance' \
    || true)
  echo "  owner USDC balance (Horizon, classic): ${OWNER_USDC:-<none / lookup failed>}" >&2
  echo "  stellar contract invoke --source-account mooring-owner --network testnet --id $TOKEN -- transfer --from mooring-owner --to $NEW --amount <n>" >&2
  exit 1
fi

if [[ "${MIGRATE_YES:-}" != "1" ]]; then
  echo "" >&2
  echo "refusing to write: set MIGRATE_YES=1 to confirm sweeping $OLD_BAL from $OLD into $NEW." >&2
  exit 1
fi

# The owner receives the swept USDC as a classic payment (cancel/withdraw pay
# out through the SAC, which settles as a classic USDC payment), which needs
# a trustline first. Idempotent: only submit change-trust when missing.
if ! curl -sf "https://horizon-testnet.stellar.org/accounts/$OWNER" | jq -e --arg iss "$USDC_ISSUER" '.balances[] | select(.asset_code=="USDC" and .asset_issuer==$iss)' >/dev/null; then
  echo "owner has no USDC trustline; adding it..."
  stellar tx new change-trust --source mooring-owner --network testnet --line "USDC:$USDC_ISSUER"
else
  echo "owner already holds a USDC trustline."
fi

if [[ "$OLD_STATE" == "2" ]]; then
  echo "old card is already Cancelled with a non-zero balance (partial earlier run) -- withdrawing instead of cancelling."
  stellar contract invoke --source-account mooring-owner --network testnet --id "$OLD" -- withdraw --amount "$OLD_BAL"
else
  stellar contract invoke --source-account mooring-owner --network testnet --id "$OLD" -- cancel
fi

stellar contract invoke --source-account mooring-owner --network testnet --id "$TOKEN" -- \
  transfer --from mooring-owner --to "$NEW" --amount "$OLD_BAL"
echo "new card balance:"
stellar contract invoke --source-account mooring-owner --network testnet --id "$NEW" -- balance
