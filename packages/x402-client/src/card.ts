export type CardState = 0 | 1 | 2; // Active, Frozen, Cancelled

export interface CardPolicy {
  period_amount: bigint;
  period_duration: bigint;
  max_per_tx: bigint;
  expiry: bigint;
}

export interface CardInfo {
  owner: string;
  signer: Uint8Array;
  token: string;
  policy: CardPolicy;
  state: CardState;
  period: { start: bigint; spent: bigint };
  remaining: bigint;
  balance: bigint;
  allow_count: number;
}
