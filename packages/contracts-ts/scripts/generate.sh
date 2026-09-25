#!/usr/bin/env bash
# Regenerates TypeScript bindings from the built wasms. Run `make build` first.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd ../.. && pwd)
# A private scratch directory per run: a fixed /tmp path is shared with every
# other user and process on the machine, and would be reused (or hijacked)
# across runs.
WORK=$(mktemp -d "${TMPDIR:-/tmp}/mooring-bindings.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
for c in card factory; do
  stellar contract bindings typescript --wasm "$ROOT/target/wasm32v1-none/release/mooring_$c.wasm" --output-dir "$WORK/$c" --overwrite >/dev/null
  mkdir -p "src/$c"
  cp "$WORK/$c/src/index.ts" "src/$c/index.ts"
done
# The generator pins an old SDK; this package uses the workspace's exact version instead.
echo "bindings regenerated: src/card/index.ts src/factory/index.ts"
