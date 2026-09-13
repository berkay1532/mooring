/**
 * Whether a failed USDC `balance(owner)` read means the owner has no USDC
 * trustline.
 *
 * The Stellar Asset Contract reads an account's balance straight from its
 * classic trustline and panics when there is none, so a *rejected* balance
 * read is the trustline check (spec §6: "Owner without a USDC trustline:
 * `withdraw`/`cancel` explain and link to how to add one"). Any other
 * failure (RPC down, malformed response) is reported as "couldn't check"
 * rather than being misattributed to a missing trustline.
 */
export type TrustlineStatus = "ok" | "missing" | "unknown";

export function trustlineStatus(error: unknown, hasBalance: boolean): TrustlineStatus {
  if (hasBalance) return "ok";
  if (!error) return "unknown";
  const message = error instanceof Error ? error.message : String(error);
  return /trustline|trust line|not found for account|missing for account/i.test(message) ? "missing" : "unknown";
}

export const TRUSTLINE_MISSING_COPY =
  "Your wallet has no USDC trustline yet, so it cannot receive USDC. Add the USDC asset in Freighter (Manage assets → Add asset), then come back.";

export const TRUSTLINE_UNKNOWN_COPY =
  "We could not read your wallet's USDC balance just now. If the transfer fails, check that your wallet holds the USDC asset.";
