/**
 * Pure, client-safe wording for a service's x402 terms when none of them is
 * payable by this card. The resolver route (`resolve.ts`) builds its
 * `no_match` message with it and `MerchantResolver` its per-entry lines, so
 * the sentence and the list can never contradict each other.
 */
import { shortAddress } from "../format/address";

/** The fields of an offered entry the wording needs. */
export interface OfferedTerms {
  network: string;
  asset: string;
  payTo: string;
  /** Absent on entries from an older server; treated as unknown, not `exact`. */
  scheme?: string;
}

/** Human label for a CAIP-2 network id; unknown ids are returned verbatim. */
export function networkLabel(network: string): string {
  if (network === "stellar:testnet") return "Stellar testnet";
  if (network === "stellar:pubnet") return "Stellar mainnet";
  return network;
}

/**
 * `message`: one sentence explaining why the card cannot pay this service.
 * `lines`: one `<network> · <asset> → <payTo>` line per offered entry, where
 * the asset reads `USDC` only when it is exactly the card's token.
 */
export function describeTerms(
  found: readonly OfferedTerms[],
  cardNetwork: string,
  cardAsset: string,
): { message: string; lines: string[] } {
  const lines = found.map(
    (f) =>
      `${networkLabel(f.network)} · ${f.asset === cardAsset ? "USDC" : `token ${shortAddress(f.asset)}`} → ${shortAddress(f.payTo)}`,
  );
  const onNetwork = found.filter((f) => f.network === cardNetwork);
  const payable = onNetwork.some((f) => f.asset === cardAsset && f.scheme === "exact");
  const message =
    onNetwork.length > 0 && !payable
      ? `This service asks for a different token or scheme on ${networkLabel(cardNetwork)}; this card holds USDC.`
      : `This service accepts ${[...new Set(found.map((f) => networkLabel(f.network)))].join(", ")}; this card holds ${networkLabel(cardNetwork)} USDC.`;
  return { message, lines };
}
