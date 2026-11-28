import { Challenge } from "mppx";
import type { ChargeChallenge } from "./schema.js";

function stellarCharges(res: Response): ChargeChallenge[] {
  try {
    return Challenge.fromResponseList(res).filter(
      (c) => c.method === "stellar" && c.intent === "charge",
    ) as unknown as ChargeChallenge[];
  } catch {
    return [];
  }
}

/** The first Stellar charge challenge a 402 offers, or null. Headers only. */
export function selectChargeChallenge(res: Response): ChargeChallenge | null {
  if (res.status !== 402) return null;
  return stellarCharges(res)[0] ?? null;
}

/**
 * Which payment protocol a response asks for. Synchronous, header-only, never
 * throws and never reads the body.
 */
export function detectProtocol(res: Response): "x402" | "mpp" | null {
  if (res.status !== 402) return null;
  if (selectChargeChallenge(res)) return "mpp";
  if (res.headers.has("PAYMENT-REQUIRED")) return "x402";
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  if (json && !res.headers.has("WWW-Authenticate")) return "x402";
  return null;
}
