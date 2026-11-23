import { Address, StrKey, hash, xdr } from "@stellar/stellar-sdk";

/**
 * A 32-byte deployer salt with the counter `n` encoded big-endian in the last
 * 4 bytes. The web app enumerates an owner's cards by walking consecutive
 * salts (0, 1, 2, …), so a card created with the next unused index is found
 * on every device without being imported.
 *
 * @throws RangeError if `n` is not an integer in `[0, 2^32)`.
 */
export function saltBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) {
    throw new RangeError(`salt index ${n} is out of range (0 .. 2^32 - 1)`);
  }
  const salt = new Uint8Array(32);
  new DataView(salt.buffer).setUint32(28, n, false);
  return salt;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * The card address `Factory::create_card(owner, …, salt)` deploys at:
 * `deploy_salt = sha256(owner.to_xdr() ‖ salt)`, then the CAP-46 contract id
 * from `(factory, deploy_salt)` on `networkPassphrase`. Pinned against the
 * same vector as the web app and the Rust test
 * (`contracts/factory/src/test.rs::derivation_vector_matches_typescript`).
 */
export function deriveCardAddress(owner: string, salt: Uint8Array, factory: string, networkPassphrase: string): string {
  const ownerXdr = Address.fromString(owner).toScVal().toXDR();
  const deploySalt = hash(concatBytes(new Uint8Array(ownerXdr), salt));
  const contractIdPreimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({ address: Address.fromString(factory).toScAddress(), salt: Buffer.from(deploySalt) }),
  );
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: Buffer.from(hash(new TextEncoder().encode(networkPassphrase))),
      contractIdPreimage,
    }),
  );
  return StrKey.encodeContract(Buffer.from(hash(preimage.toXDR())));
}

/** The ledger key of a contract's instance entry — present only once the contract is deployed. */
export function contractInstanceKey(address: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(address).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  );
}
