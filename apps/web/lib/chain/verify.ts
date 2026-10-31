import { xdr } from "@stellar/stellar-sdk";

import { contractInstanceKey } from "./derive";
import type { LedgerEntriesRpc } from "./rpc";

/**
 * Turns a `getLedgerEntries` entry into `LedgerEntryData`. The SDK's
 * `rpc.Server` already parses it into `val`; a raw JSON-RPC answer carries
 * base64 in `xdr` instead. Both are accepted.
 */
function entryData(entry: unknown): xdr.LedgerEntryData | null {
  const e = entry as { val?: unknown; xdr?: unknown } | null;
  if (!e) return null;
  if (e.val && typeof (e.val as { type?: unknown }).type === "string") {
    return e.val as xdr.LedgerEntryData;
  }
  if (typeof e.xdr === "string") return xdr.LedgerEntryData.fromXdr(e.xdr, "base64");
  return null;
}

/** Lowercase hex, without `Buffer` (absent from the browser bundle). */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The hex WASM hash of the code the contract at `address` runs, read from its
 * contract-instance ledger entry. `null` when no instance entry exists, or
 * when the executable is a Stellar asset contract (no WASM).
 *
 * @throws on an RPC error or a malformed response — never read as "no hash".
 */
export async function readContractWasmHash(
  rpc: LedgerEntriesRpc,
  address: string,
): Promise<string | null> {
  const response = await rpc.getLedgerEntries(contractInstanceKey(address));
  if (!Array.isArray(response?.entries)) {
    throw new Error("Malformed getLedgerEntries response: no entries array");
  }
  const [entry] = response.entries;
  if (entry === undefined) return null;
  const data = entryData(entry);
  if (!data || data.type !== "contractData") return null;
  const val = data.contractData.val;
  if (val.type !== "scvContractInstance") return null;
  const executable = val.instance.executable;
  if (executable.type !== "contractExecutableWasm") return null;
  return toHex(executable.wasmHash.value);
}

/**
 * Proves the contract at `address` runs the Mooring card code, by comparing
 * its instance's WASM hash with `expectedHash`. Anything a contract answers
 * through its own functions (`info()`, `owner`, …) is only trustworthy after
 * this check: an arbitrary contract can claim any owner.
 *
 * @throws `Error("This address is not a Mooring card.")` when the hash is
 *   missing or differs.
 */
export async function assertMooringCard(
  rpc: LedgerEntriesRpc,
  address: string,
  expectedHash: string,
): Promise<void> {
  const actual = await readContractWasmHash(rpc, address);
  if (actual === null || actual !== expectedHash.toLowerCase()) {
    throw new Error("This address is not a Mooring card.");
  }
}
