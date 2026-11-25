/**
 * One normalised chain event, whichever source produced it. The indexer stores
 * card-level kinds in `card_events` and `transfer` in `payments`; everything
 * else the sources emit is dropped before it gets here.
 */
export const CARD_EVENT_KINDS = [
  "created",
  "merchant_added",
  "merchant_removed",
  "policy_changed",
  "signer_changed",
  "label_changed",
  "state_changed",
  "withdrawn",
] as const;

export type CardEventKind = (typeof CARD_EVENT_KINDS)[number];

export type IndexedKind = CardEventKind | "transfer";

/** Decoded event fields. Bigints are decimal strings; byte arrays are lowercase hex. */
export type Payload = Record<string, string | number | boolean | null>;

export interface IndexedEvent {
  /** Globally unique per source: the RPC event id, or `se:<toid>` for stellar.expert rows. */
  eventId: string;
  ledger: number;
  /** Unknown until resolved for stellar.expert rows. */
  txHash: string | null;
  /** ISO-8601 close time. */
  ts: string;
  /** The emitting contract: the factory, a card, or the USDC SAC. */
  contract: string;
  kind: IndexedKind;
  /**
   * `created`: `{ owner, card }` (emitted by the factory; `contract` is the factory).
   * `merchant_added` / `merchant_removed`: `{ merchant }`.
   * `policy_changed`: `{ expiry, max_per_tx, period_amount, period_duration }`.
   * `signer_changed`: `{ signer }` (hex). `label_changed`: `{ label }`.
   * `state_changed`: `{ state, stateName }`. `withdrawn`: `{ to, amount }`.
   * `transfer`: `{ from, to, amount }` (SAC transfer; `contract` is the SAC).
   */
  payload: Payload;
}

export const STATE_NAMES = ["active", "frozen", "cancelled"] as const;

export function stateName(state: number): string {
  return STATE_NAMES[state] ?? `state_${state}`;
}
