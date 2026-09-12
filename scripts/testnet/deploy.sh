#!/usr/bin/env bash
# Deploys the factory and creates one card on Stellar testnet.
# Requires: stellar CLI, node (for the agent key hex conversion), jq.
set -euo pipefail
cd "$(dirname "$0")/../.."

NETWORK=testnet
USDC_SAC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
OUT=deployed.testnet.json

for id in mooring-deployer mooring-owner mooring-agent mooring-merchant mooring-funder; do
  if ! stellar keys address "$id" >/dev/null 2>&1; then
    # CLI 26.1.0 has no `--global` flag (identities are saved to the global
    # config dir by default); the brief's `--global` was dropped here.
    stellar keys generate "$id" --network $NETWORK
  fi
  addr=$(stellar keys address "$id")
  # A local key can exist (from a prior run) while the on-chain account
  # doesn't -- testnet resets quarterly. Check Horizon, not just the local
  # keystore, and (re)fund with friendbot whenever the account is missing.
  if ! curl -sf "https://horizon-testnet.stellar.org/accounts/$addr" >/dev/null; then
    stellar keys fund "$id" --network $NETWORK
  fi
done

# Merchant and funder must hold a USDC trustline (SAC settles into classic
# balances). Only submit change-trust when the trustline is actually
# missing (idempotent across reruns and testnet resets); let a real
# change-trust failure abort the script instead of being swallowed.
for id in mooring-merchant mooring-funder; do
  addr=$(stellar keys address "$id")
  if ! curl -sf "https://horizon-testnet.stellar.org/accounts/$addr" \
      | jq -e --arg iss "$USDC_ISSUER" \
        '.balances[] | select(.asset_code=="USDC" and .asset_issuer==$iss)' >/dev/null; then
    stellar tx new change-trust --source "$id" --network $NETWORK \
      --line "USDC:$USDC_ISSUER"
  fi
done

if [[ "${DEPLOY_DRY_RUN:-}" == "1" ]]; then
  echo "DEPLOY_DRY_RUN=1: identity funding and trustline checks done; stopping before build/deploy."
  exit 0
fi

# The factory's soroban-sdk dependency enables `experimental_spec_shaking_v2`
# (see contracts/factory/Cargo.toml) so the imported `card::Policy` type gets
# a full spec entry in the factory's own contractspecv0 section -- required
# for the `stellar` CLI's implicit CLI (used below for deploy/invoke) to work
# at all against the factory contract. `make build` already builds the
# factory via `stellar contract build` (required by that feature) and the
# card via plain `cargo build`.
make build

CARD_WASM_HASH=$(stellar contract upload --source mooring-deployer --network $NETWORK \
  --wasm target/wasm32v1-none/release/mooring_card.wasm)
FACTORY=$(stellar contract deploy --source mooring-deployer --network $NETWORK \
  --wasm target/wasm32v1-none/release/mooring_factory.wasm \
  -- --card_wasm_hash "$CARD_WASM_HASH")

AGENT_G=$(stellar keys address mooring-agent)
# BytesN<32> args are passed to the CLI as hex; decode the agent's G address.
# scripts/agent/package.json is "type":"module", so a plain `require()` script
# fails there; run this one-liner in CommonJS mode instead. decodeEd25519PublicKey
# returns a Uint8Array (not a Node Buffer), whose .toString('hex') does NOT
# produce hex -- wrap it in Buffer.from() first.
AGENT_PK_HEX=$(cd scripts/agent && node --input-type=commonjs -e \
  "const {StrKey}=require('@stellar/stellar-sdk');console.log(Buffer.from(StrKey.decodeEd25519PublicKey(process.argv[1])).toString('hex'))" "$AGENT_G")

# A malformed key would deploy a card no agent can ever sign for, and the
# failure would only surface at the first payment attempt.
if [[ ! "$AGENT_PK_HEX" =~ ^[0-9a-f]{64}$ ]]; then
  echo "AGENT_PK_HEX is not 64 lowercase hex chars: '$AGENT_PK_HEX'" >&2
  exit 1
fi

EXPIRY=$(( $(date +%s) + 30*86400 ))
SALT=$(openssl rand -hex 32)
POLICY="{\"period_amount\":\"500000000\",\"period_duration\":86400,\"max_per_tx\":\"100000000\",\"expiry\":$EXPIRY}"

CARD=$(stellar contract invoke --source mooring-owner --network $NETWORK --id "$FACTORY" -- \
  create_card --owner mooring-owner --signer "$AGENT_PK_HEX" --token "$USDC_SAC" \
  --policy "$POLICY" --salt "$SALT" | tr -d '"')

MERCHANT=$(stellar keys address mooring-merchant)
stellar contract invoke --source mooring-owner --network $NETWORK --id "$CARD" -- \
  add_merchant --merchant "$MERCHANT" >/dev/null

jq -n --arg factory "$FACTORY" --arg card "$CARD" --arg hash "$CARD_WASM_HASH" \
  --arg token "$USDC_SAC" --arg owner "$(stellar keys address mooring-owner)" \
  --arg agent "$AGENT_G" --arg agent_pk_hex "$AGENT_PK_HEX" --arg merchant "$MERCHANT" \
  --arg funder "$(stellar keys address mooring-funder)" \
  '{factory:$factory, card:$card, card_wasm_hash:$hash, token:$token, owner:$owner, agent:$agent, agent_pk_hex:$agent_pk_hex, merchant:$merchant, funder:$funder}' > $OUT

echo "Deployed. See $OUT"
echo "Next: get testnet USDC for the funder at https://faucet.circle.com (Stellar testnet):"
echo "  $(stellar keys address mooring-funder)"
echo "Then run scripts/testnet/fund.sh"
