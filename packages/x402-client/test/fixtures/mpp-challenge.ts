import { Challenge, Method, z } from "mppx";
import { chargeMethod } from "../../src/mpp/schema.js";

export const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const PAY_TO = "GAW6UY5FPAPSDGGEPGUSQJZYQOQB6CBJASUHJWL4U6V6TXT6CKVMVVUW";

/** A 402 carrying a serialized Stellar charge challenge. */
export function mppChallengeResponse(): Response {
  const challenge = Challenge.fromMethod(chargeMethod, {
    secretKey: "test",
    realm: "api.mooring.live",
    request: {
      amount: "10000",
      currency: USDC_TESTNET,
      recipient: PAY_TO,
      methodDetails: { network: "stellar:testnet", credentialTypes: ["transaction"] },
    },
  });
  return new Response(null, {
    status: 402,
    headers: { "WWW-Authenticate": Challenge.serialize(challenge) },
  });
}

const tempoMethod = Method.from({
  name: "tempo",
  intent: "charge",
  schema: {
    credential: { payload: z.object({ type: z.literal("hash"), hash: z.string() }) },
    request: z.object({ amount: z.string() }),
  },
});

/** A 402 carrying a Payment challenge for a method the client does not speak. */
export function tempoChallengeResponse(): Response {
  const challenge = Challenge.fromMethod(tempoMethod, {
    secretKey: "test",
    realm: "api.mooring.live",
    request: { amount: "1" },
  });
  return new Response(null, {
    status: 402,
    headers: { "WWW-Authenticate": Challenge.serialize(challenge) },
  });
}
