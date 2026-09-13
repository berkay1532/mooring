/**
 * Shortens a Stellar/Soroban address (or any long identifier) for display:
 * first 4 chars, an ellipsis, last 4 chars (`"CBOO…UH5W"`).
 *
 * Strings too short to usefully shorten (8 chars or fewer) are returned
 * unchanged.
 */
export function shortAddress(a: string): string {
  if (a.length <= 8) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}
