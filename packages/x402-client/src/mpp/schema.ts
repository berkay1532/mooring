import { Challenge, Method, z } from "mppx";

/** Upper bound on a signed transaction XDR carried in a credential. */
const MAX_XDR_LENGTH = 8_192;

/**
 * The Stellar charge method of the Machine Payments Protocol, carried here
 * (schema copied from the `@stellar/mpp` SDK) so the client does not depend on
 * that package.
 *
 * Credential flows: `signedHash` (client broadcasts, proves the payer),
 * `hash` (legacy, receive-only) and `transaction` (server broadcasts).
 */
export const chargeMethod = Method.from({
  name: "stellar",
  intent: "charge",
  schema: {
    credential: {
      payload: z.discriminatedUnion("type", [
        z.object({
          hash: z.string().check(z.regex(/^[0-9a-f]{64}$/i)),
          sourceSignature: z.string().check(z.regex(/^[0-9a-f]{128}$/i)),
          type: z.literal("signedHash"),
        }),
        z.object({
          hash: z.string().check(z.regex(/^[0-9a-f]{64}$/i)),
          type: z.literal("hash"),
        }),
        z.object({
          transaction: z.string().check(z.maxLength(MAX_XDR_LENGTH)),
          type: z.literal("transaction"),
        }),
      ]),
    },
    request: z.object({
      /** Payment amount in base units. */
      amount: z.string(),
      /** SEP-41 token contract address (C...). */
      currency: z.string(),
      /** Recipient Stellar public key (G...) or contract address (C...). */
      recipient: z.string(),
      description: z.optional(z.string()),
      /** Merchant-provided reconciliation id. */
      externalId: z.optional(z.string()),
      methodDetails: z.optional(
        z.object({
          /** CAIP-2 network identifier, e.g. "stellar:testnet". */
          network: z.string(),
          /** Whether the server sponsors the transaction. */
          feePayer: z.optional(z.boolean()),
          /** Credential payload types the server accepts, in preference order. */
          credentialTypes: z.optional(z.array(z.string())),
          /** Per-challenge nonce set by the server. */
          reference: z.optional(z.string()),
          /** ISO 8601 time the server issued the challenge. */
          issuedAt: z.optional(z.string()),
        }),
      ),
    }),
  },
});

export type ChargeRequest = z.output<typeof chargeMethod.schema.request>;
export type ChargeChallenge = Challenge.Challenge<ChargeRequest, "charge", "stellar">;
