import { Address, Keypair, StrKey, buildAuthorizationEntryPreimage, hash, scValToNative, xdr } from "@stellar/stellar-sdk";

/**
 * The address credentials of a Soroban auth entry: the legacy V1
 * `sorobanCredentialsAddress` arm or the CAP-71 V2 `sorobanCredentialsAddressV2`
 * arm. `undefined` for every other arm (source-account, delegated): a
 * delegated entry is authorized by keys other than the address it names.
 */
export function addressCredentials(credentials: xdr.SorobanCredentials): xdr.SorobanAddressCredentials | undefined {
  switch (credentials.type) {
    case "sorobanCredentialsAddress":
      return credentials.address;
    case "sorobanCredentialsAddressV2":
      return credentials.addressV2;
    default:
      return undefined;
  }
}

/**
 * Verifies the ed25519 signature carried by an auth entry whose authorizer is
 * a Stellar account (`G…`), against the same preimage `authorizeEntry` signs
 * and the network validates. A contract authorizer (a card's `__check_auth`)
 * cannot be verified off-chain; the enforcing simulation does that.
 *
 * Ported from the `@stellar/mpp` SDK's `verifyAuthEntrySignature`.
 *
 * @throws {Error} when the entry is not address-signed by a Stellar account,
 *   the signature is malformed, signed by another key, or does not verify.
 */
export function verifyAuthEntrySignature(entry: xdr.SorobanAuthorizationEntry, networkPassphrase: string): void {
  const credentials = addressCredentials(entry.credentials);
  if (!credentials) throw new Error("auth entry must use address credentials");

  const authorizer = credentials.address;
  if (authorizer.type !== "scAddressTypeAccount") {
    throw new Error("auth entry authorizer must be a Stellar account");
  }
  const authorizerKey = Address.fromScAddress(authorizer).toString();

  // The SDK derives the preimage from the credential arm (V1 signs
  // ENVELOPE_TYPE_SOROBAN_AUTHORIZATION, V2 the address-bound variant), so
  // verifier and signer stay in lockstep.
  const preimage = buildAuthorizationEntryPreimage(entry, credentials.signatureExpirationLedger, networkPassphrase);
  const payload = hash(preimage.toXdr());

  const signatures = accountSignatures(credentials.signature);
  if (signatures.length === 0) throw new Error("auth entry carries no signatures");
  for (const { publicKey, signature } of signatures) {
    if (publicKey !== authorizerKey) throw new Error("auth entry is signed by a key other than its authorizer");
    if (!Keypair.fromPublicKey(publicKey).verify(payload, signature)) {
      throw new Error("auth entry signature does not match the authorization payload");
    }
  }
}

/**
 * Decodes the `Vec<{ public_key, signature }>` an account authorizer's
 * signature carries. Any other shape is rejected, never skipped, and only a
 * single signature is accepted (an account is satisfied by one).
 */
function accountSignatures(signature: xdr.ScVal): Array<{ publicKey: string; signature: Buffer }> {
  if (signature.type === "scvVec" && (signature.vec ?? []).length > 1) {
    throw new Error("auth entry must carry a single account signature");
  }
  let decoded: unknown;
  try {
    decoded = scValToNative(signature);
  } catch (err) {
    throw new Error(`auth entry signature is not valid Soroban data: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(decoded)) throw new Error("auth entry signature must be a vector of account signatures");
  return decoded.map((sig: unknown) => {
    if (typeof sig !== "object" || sig === null || !("public_key" in sig) || !("signature" in sig)) {
      throw new Error("auth entry signature must contain a public_key and a signature");
    }
    const { public_key: key, signature: bytes } = sig as { public_key: unknown; signature: unknown };
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error("auth entry signature has an invalid public key");
    if (!(bytes instanceof Uint8Array) || bytes.length !== 64) throw new Error("auth entry signature has an invalid length");
    return { publicKey: StrKey.encodeEd25519PublicKey(Buffer.from(key)), signature: Buffer.from(bytes) };
  });
}
