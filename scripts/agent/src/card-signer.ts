import {
  authorizeEntry,
  contract,
  Keypair,
  xdr,
  type SigningCallback,
} from "@stellar/stellar-sdk";

/**
 * Signs every auth entry addressed to `cardAddress` with the agent key.
 *
 * The stock SEP-43 path cannot do this: `signAuthEntries`' default
 * `authorizeEntry` derives the signer public key from the entry's credential
 * address, which here is the card's `C…` address, and `Keypair.fromPublicKey`
 * rejects a contract strkey. So we override `authorizeEntry` and hand it a
 * `SigningCallback` that returns `{ signature, publicKey }`. The SDK then
 * encodes the credential signature as `Vec[{ public_key, signature }]`, which
 * is exactly what the card's `__check_auth` (`Signature = Vec<Sig>`) consumes.
 */
export async function signCardAuthEntries(
  tx: contract.AssembledTransaction<unknown>,
  cardAddress: string,
  agent: Keypair,
  expirationLedger: number,
): Promise<void> {
  const signPayload: SigningCallback = async (_preimage, payload) => ({
    signature: Uint8Array.from(agent.sign(Buffer.from(payload))),
    publicKey: agent.publicKey(),
  });

  await tx.signAuthEntries({
    address: cardAddress,
    expiration: expirationLedger,
    authorizeEntry: (
      entry: xdr.SorobanAuthorizationEntry,
      _signer: Keypair | SigningCallback,
      validUntilLedgerSeq: number,
      networkPassphrase: string,
      // `authorizeEntry`'s real 5th parameter, used for nested/delegate
      // credentials. `signAuthEntries` calls this callback with 4 arguments,
      // so it is always `undefined` here; it is forwarded verbatim so the
      // override stays a drop-in for the SDK's default.
      forAddress?: string,
    ) =>
      authorizeEntry(
        entry,
        signPayload,
        validUntilLedgerSeq,
        networkPassphrase,
        forAddress,
      ),
  });
}
