import { describe, expect, it } from "vitest";
import { Keypair, xdr, hash, Address, nativeToScVal, authorizeEntry } from "@stellar/stellar-sdk";
import { signCardAuthEntries } from "../src/signer.js";

// Builds an unsigned auth entry addressed to `card` for token.transfer(card, to, amount).
function unsignedEntry(card: string, token: string, to: string, amount: bigint): xdr.SorobanAuthorizationEntry {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(token).toScAddress(),
        functionName: "transfer",
        args: [
          nativeToScVal(Address.fromString(card), { type: "address" }),
          nativeToScVal(Address.fromString(to), { type: "address" }),
          nativeToScVal(amount, { type: "i128" }),
        ],
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(card).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  });
}

/** Builds the fake AssembledTransaction both tests sign through. */
function fakeTxFor(entry: xdr.SorobanAuthorizationEntry, passphrase: string) {
  const authSlot: { auth: xdr.SorobanAuthorizationEntry[] } = { auth: [entry] };
  const tx = {
    built: { operations: [authSlot] },
    options: { networkPassphrase: passphrase },
    signAuthEntries: async (opts: { authorizeEntry?: Function }) => {
      // emulate the SDK: call the custom authorizeEntry with 4 args
      authSlot.auth[0] = await opts.authorizeEntry!(entry, undefined, 123456, passphrase);
    },
  } as unknown as Parameters<typeof signCardAuthEntries>[0];
  return { tx, authSlot };
}

describe("signCardAuthEntries", () => {
  it("signs without a global Buffer, so the client runs in a browser", async () => {
    const agent = Keypair.random();
    const card = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
    const token = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const passphrase = "Test SDF Network ; September 2015";
    const entry = unsignedEntry(card, token, Keypair.random().publicKey(), 10_000n);
    const { tx, authSlot } = fakeTxFor(entry, passphrase);

    const realBuffer = globalThis.Buffer;
    try {
      // @ts-expect-error deliberately removing the Node global
      delete globalThis.Buffer;
      await signCardAuthEntries(tx, card, agent, 123456);
    } finally {
      globalThis.Buffer = realBuffer;
    }

    const creds = (authSlot.auth[0]!.credentials as any).address as xdr.SorobanAddressCredentials;
    expect(creds.signatureExpirationLedger).toBe(123456);
    expect(((creds.signature as any).vec as xdr.ScVal[]).length).toBe(1);
  });

  it("signs entries addressed to the card with the agent key and encodes Vec[{public_key, signature}]", async () => {
    const agent = Keypair.random();
    const card = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
    const token = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const to = Keypair.random().publicKey();
    const entry = unsignedEntry(card, token, to, 10_000n);
    const passphrase = "Test SDF Network ; September 2015";

    // Fake AssembledTransaction: only `built.operations[0].auth` and `signAuthEntries` are used.
    // `authSlot` is mutated by the fake `signAuthEntries` below and read back
    // afterwards; it is declared with its own type (rather than reading back
    // through `fakeTx`, whose static type is the real `AssembledTransaction`
    // after the cast) so the self-referential write below still type-checks.
    const authSlot: { auth: xdr.SorobanAuthorizationEntry[] } = { auth: [entry] };
    let received: { address?: string; expiration?: unknown; authorizeEntry?: Function } | undefined;
    const fakeTx = {
      built: { operations: [authSlot] },
      options: { networkPassphrase: passphrase },
      signAuthEntries: async (opts: typeof received) => {
        received = opts;
        // emulate the SDK: call the custom authorizeEntry with 4 args
        const signed = await opts!.authorizeEntry!(entry, undefined, 123456, passphrase);
        authSlot.auth[0] = signed;
      },
    } as unknown as Parameters<typeof signCardAuthEntries>[0];

    await signCardAuthEntries(fakeTx, card, agent, 123456);

    expect(received?.address).toBe(card);
    const signed = authSlot.auth[0];
    // NOTE: @stellar/stellar-sdk 17.x's generated xdr classes expose plain
    // readonly properties (`.credentials`, `.address`, ...), not the
    // method-call accessors (`.credentials()`, `.address()`, ...) of older
    // SDK versions. Drill-downs below cast through `any` at the point where
    // TS can't statically narrow the `ScVal` union to its concrete variant.
    const creds = (signed.credentials as any).address as xdr.SorobanAddressCredentials;
    expect(creds.signatureExpirationLedger).toBe(123456);
    const sigVec = (creds.signature as any).vec as xdr.ScVal[];
    expect(sigVec.length).toBe(1);
    const map = (sigVec[0] as any).map as xdr.ScMapEntry[];
    const symOf = (v: xdr.ScVal): string => (v as any).sym.toString();
    const keys = map.map((e) => symOf(e.key)).sort();
    expect(keys).toEqual(["public_key", "signature"]);
    const pk = ((map.find((e) => symOf(e.key) === "public_key")!.val as any).bytes as xdr.ScBytes).value;
    expect(Buffer.from(pk).equals(agent.rawPublicKey())).toBe(true);
    // The signature must verify over sha256(preimage) — recompute with the SDK helper.
    const sig = ((map.find((e) => symOf(e.key) === "signature")!.val as any).bytes as xdr.ScBytes).value;
    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(Buffer.from(passphrase)),
        nonce: creds.nonce,
        signatureExpirationLedger: creds.signatureExpirationLedger,
        invocation: signed.rootInvocation,
      }),
    );
    expect(agent.verify(hash(preimage.toXDR()), Buffer.from(sig))).toBe(true);
  });
});
