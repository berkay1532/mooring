/**
 * A base64 Stellar transaction envelope carrying a single
 * `invokeHostFunction` for `transfer(card, merchant, 10000)` on the testnet
 * USDC SAC. It is a static fixture: the scheme tests only need a real envelope
 * to hand to `new Transaction(...)` and to re-parse from the produced payload,
 * so nothing about it has to be fundable or submittable.
 *
 * Produced once with:
 *
 * ```ts
 * const source = new Account(Keypair.random().publicKey(), "1");
 * const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.TESTNET })
 *   .addOperation(Operation.invokeContractFunction({
 *     contract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
 *     function: "transfer",
 *     args: [
 *       nativeToScVal(Address.fromString("CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ"), { type: "address" }),
 *       nativeToScVal(Address.fromString("GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG"), { type: "address" }),
 *       nativeToScVal(10000n, { type: "i128" }),
 *     ],
 *   }))
 *   .setTimeout(60)
 *   .build();
 * console.log(tx.toXDR());
 * ```
 */
export const TRANSFER_TX_XDR =
  "AAAAAgAAAADjXmiGM244YgVotZPtF5e9aYTGoZWqR24w7NXkJUk3hQAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAABqpKwWAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABUEXNXsBymnaP1a0CUFhS308Cjc6DDlrFIgm6SEg7LwEAAAAIdHJhbnNmZXIAAAADAAAAEgAAAAES+yQlCz1mYyGNIg/W2zKkth5nQjKIlqVVJAfa/O69gAAAABIAAAAAAAAAAC21SSEym2PxbKQjcIpAovmKALxZDsc1g7lCwG0d1xt1AAAACgAAAAAAAAAAAAAAAAAAJxAAAAAAAAAAAAAAAAA=";
