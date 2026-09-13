/**
 * The chain the end-to-end tests run against: one owner (the mock wallet's
 * fixed address), the factory and USDC SAC from `.env.example`, and two cards
 * deployed at deployer salts 0 and 1.
 *
 * Card addresses are derived with the app's own `deriveCardAddress`, so
 * `discoverCards` — which probes `(factory, owner, salt)` in order — finds
 * exactly these two and stops at the first gap (salt 2).
 */
import { Keypair } from "@stellar/stellar-sdk";

import { deriveCardAddress, saltBytes } from "../../lib/chain/derive";

export { FACTORY, NETWORK_PASSPHRASE, RPC_URL, USDC } from "./env";
import { FACTORY, NETWORK_PASSPHRASE } from "./env";

/** The address `lib/wallet/mock.ts` always connects to. */
export const OWNER = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";

/** Deterministic keys, so every assertion can name an exact address. */
export const AGENT_KEY = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
export const AGENT_KEY_2 = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
export const MERCHANT_1 = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();

/** USDC base units per whole USDC (7 decimals). */
export const UNIT = 10_000_000n;

export function cardAddress(salt: number): string {
  return deriveCardAddress(OWNER, saltBytes(salt), FACTORY, NETWORK_PASSPHRASE);
}

/** Everything `info()` reports for one card, as the mock serves it. */
export interface CardFixture {
  address: string;
  label: string;
  /** 0 Active, 1 Frozen, 2 Cancelled. */
  state: number;
  balance: bigint;
  spent: bigint;
  periodStart: bigint;
  periodAmount: bigint;
  maxPerTx: bigint;
  periodDuration: bigint;
  /** Unix seconds. Well in the future so the card never reads as expired. */
  expiry: bigint;
  signer: string;
  merchants: string[];
}

/** A long-lived expiry (2 Jan 2100) — these tests never exercise expiry. */
export const FAR_EXPIRY = 4_102_444_800n;
const PERIOD_START = 1_757_000_000n;

export const CARD_ONE: CardFixture = {
  address: cardAddress(0),
  label: "inference-agent",
  state: 0,
  balance: 420n * UNIT,
  spent: 125n * UNIT / 10n,
  periodStart: PERIOD_START,
  periodAmount: 50n * UNIT,
  maxPerTx: 10n * UNIT,
  periodDuration: 86_400n,
  expiry: FAR_EXPIRY,
  signer: AGENT_KEY,
  merchants: [MERCHANT_1],
};

export const CARD_TWO: CardFixture = {
  address: cardAddress(1),
  label: "scraper-agent",
  state: 1,
  balance: 18n * UNIT,
  spent: 0n,
  periodStart: PERIOD_START,
  periodAmount: 25n * UNIT,
  maxPerTx: 5n * UNIT,
  periodDuration: 604_800n,
  expiry: FAR_EXPIRY,
  signer: AGENT_KEY_2,
  merchants: [],
};

export const DEFAULT_CARDS: CardFixture[] = [CARD_ONE, CARD_TWO];

/** The owner's own USDC balance (the Fund sheet's "in wallet" figure). */
export const DEFAULT_OWNER_BALANCE = 250n * UNIT;
