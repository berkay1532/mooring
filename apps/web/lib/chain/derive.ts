import { Address, StrKey, hash, xdr } from "@stellar/stellar-sdk";

/**
 * A 32-byte deployer salt with the counter `n` encoded big-endian in the
 * last 4 bytes. The factory enumerates one owner's cards by walking
 * consecutive salts (0, 1, 2, ...), so callers must pick `n` in that order.
 */
export function saltBytes(n: number): Uint8Array {
  const salt = new Uint8Array(32);
  new DataView(salt.buffer).setUint32(28, n, false);
  return salt;
}

/**
 * Concatenates byte arrays without going through Node's `Buffer`: in a
 * jsdom test environment `Buffer`'s prototype chain is not `instanceof`
 * the realm's own `Uint8Array`, which `@noble/hashes` (via `hash()`)
 * strictly checks for. Plain `Uint8Array` avoids that pitfall in every
 * environment, browser included.
 */
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Derives a card's contract address deterministically from
 * `(factory, owner, salt)`, mirroring `Factory::create_card`
 * (`contracts/factory/src/lib.rs:55-85`):
 *
 * ```text
 * deploy_salt = sha256(owner.to_xdr(env) ‖ salt)
 * card        = standard contract id from (factory, deploy_salt)
 * ```
 *
 * The contract id itself follows the CAP-46 "from address" preimage:
 * `sha256(HashIdPreimage::envelopeTypeContractId({ networkId, contractIdPreimage }))`,
 * StrKey-encoded as a contract address (`C...`).
 *
 * Pinned against a shared test vector in `derive.test.ts` and
 * `contracts/factory/src/test.rs::derivation_vector_matches_typescript` —
 * the Rust side is authoritative because it mirrors `create_card` itself.
 */
export function deriveCardAddress(
  owner: string,
  salt: Uint8Array,
  factory: string,
  networkPassphrase: string,
): string {
  const ownerAddressXdr = Address.fromString(owner).toScVal().toXDR();
  const deploySalt = hash(concatBytes(ownerAddressXdr, salt));

  const contractIdPreimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: Address.fromString(factory).toScAddress(),
      salt: deploySalt,
    }),
  );
  const hashIdPreimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(new TextEncoder().encode(networkPassphrase)),
      contractIdPreimage,
    }),
  );
  const contractId = hash(hashIdPreimage.toXDR());
  return StrKey.encodeContract(contractId);
}

/**
 * The ledger key for a contract's instance entry — used to probe whether a
 * derived address has actually been deployed (`getLedgerEntries` returns an
 * empty `entries` array, not an error, for a key that does not exist).
 */
export function contractInstanceKey(address: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(address).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
}
