"use client";

import { Buffer } from "buffer";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@mooring/contracts-ts";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";

import { useTxToast } from "@/components/ui/TxToast";
import { buildAddMerchant, buildCreateCard } from "@/lib/chain/card";
import type { TranslatedError } from "@/lib/chain/errors";
import { saltBytes } from "@/lib/chain/derive";
import { explorerTxUrl } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { shortAddress } from "@/lib/format/address";
import { useContractAction, type ActionState, type TxDetails } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";

export interface CreateCardDraft {
  owner: string;
  label: string;
  policy: Card.Policy;
  /** The agent's raw 32-byte ed25519 public key. */
  signer: Buffer;
  merchants: readonly string[];
  /** The first free deployer salt for this owner. */
  salt: number;
  /** The address `(factory, owner, salt)` derives to — what the card will be called. */
  address: string;
}

export type CreatePhase = "idle" | "card" | "merchants" | "done";

export interface CreateCardFlow {
  phase: CreatePhase;
  /**
   * The card's address, frozen the moment creation starts: the derived one
   * until the factory's own result arrives. `null` while `phase` is
   * `"idle"`. Never follows the salt query afterwards — that query refetches
   * as soon as the card lands and would then point at the *next* card.
   */
  address: string | null;
  /** How many merchants have been added so far. */
  merchantIndex: number;
  state: ActionState;
  hash: string | null;
  error: TranslatedError | null;
  /** What the transaction on screen is handing the wallet (spec §7). */
  details: TxDetails | null;
  /** A transaction is in flight, or more are queued. */
  busy: boolean;
  /**
   * The wizard must stay read-only: something is in flight, or a card has
   * already been deployed and going back would desync what is on screen from
   * what exists. False again after a create that failed *before* submission
   * (a declined signature, a failed simulation) — nothing was deployed, so
   * Back and the step chips have to work again. The salt and address stay
   * frozen either way, so a retry deploys at the same place.
   */
  locked: boolean;
  /** Starts the card transaction, then one `add_merchant` per collected merchant. */
  start(): void;
  /** Retries the merchant transaction that failed. */
  retryMerchant(): void;
  /** Gives up on the remaining merchants and opens the card anyway. */
  skipMerchants(): void;
}

/**
 * The simulated `create_card` result — the deployed card's address. The
 * factory derives it deterministically from `(factory, owner, salt)`, so
 * the simulated value is the real one; the caller still keeps its own
 * derived address as a fallback for when the result cannot be read.
 */
function createdAddress(tx: AssembledTransaction<string> | null): string | null {
  try {
    const result = tx?.result;
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

/** "Add merchant GAW3…M2KA (2 of 3)" — one merchant transaction's toast label. */
function merchantLabel(merchants: readonly string[], index: number): string {
  return `Add merchant ${shortAddress(merchants[index] ?? "")} (${index + 1} of ${merchants.length})`;
}

/**
 * Drives card creation: one `create_card` transaction, then one
 * `add_merchant` per merchant collected in the wizard.
 *
 * The merchants are separate transactions because the factory's
 * `create_card` takes no allowlist (`contracts/factory/src/lib.rs`) — the
 * card's allowlist is only writable by the owner afterwards. They run one
 * at a time, each with its own signature; if one fails the sequence stops
 * with the error on screen and the owner can retry it or skip the rest (the
 * card already exists, and merchants can be added from the card itself).
 *
 * `onFinished` is called exactly once, with the new card's address.
 */
export function useCreateCard(
  draft: CreateCardDraft | null,
  onFinished: (address: string) => void,
): CreateCardFlow {
  const [phase, setPhase] = useState<CreatePhase>("idle");
  const [merchantIndex, setMerchantIndex] = useState(0);

  // Refs, not state: these are read from inside callbacks that must never
  // re-run just because the draft object identity changed on a keystroke.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const finishedCb = useRef(onFinished);
  finishedCb.current = onFinished;

  // The draft as it was when `start()` ran. Everything after that point —
  // the salt, the derived address, the merchant list — reads from here, so
  // neither a refetched salt nor an edit on a step the owner walked back to
  // can change what is being deployed or what is on screen.
  const activeRef = useRef<CreateCardDraft | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  const cardRef = useRef<string | null>(null);
  const builtRef = useRef<AssembledTransaction<string> | null>(null);
  const finishedRef = useRef(false);
  const startedRef = useRef(-1);

  const create = useContractAction<CreateCardDraft>(
    async (d, wallet) => {
      const tx = await buildCreateCard(
        {
          owner: d.owner,
          signer: d.signer,
          token: config.usdc,
          policy: d.policy,
          label: d.label,
          salt: Buffer.from(saltBytes(d.salt)),
        },
        wallet,
      );
      builtRef.current = tx;
      return tx;
    },
    {
      // `keys.cards(owner)` is a prefix of `keys.nextSalt(owner)`, so this
      // one key refreshes both the dashboard's card list and the salt the
      // wizard would deploy the *next* card at.
      invalidates: (d) => [keys.cards(d.owner)],
      onConfirmed: () => {
        cardRef.current = createdAddress(builtRef.current) ?? activeRef.current?.address ?? null;
        if (cardRef.current) setAddress(cardRef.current);
        setPhase("merchants");
      },
    },
  );

  const addMerchant = useContractAction<{ card: string; merchant: string }>(
    ({ card, merchant }, wallet) => buildAddMerchant(card, merchant, wallet),
    {
      invalidates: ({ card }) => [keys.merchants(card), keys.info(card)],
      onConfirmed: () => setMerchantIndex((index) => index + 1),
    },
  );

  // One toast per transaction (spec §3.3 + the toast stack): the card, then
  // each merchant. Labels are fixed when each run starts.
  const createToast = useTxToast(create, { explorerUrl: explorerTxUrl });
  const merchantToast = useTxToast(addMerchant, { explorerUrl: explorerTxUrl });
  const beginCreate = createToast.begin;
  const beginMerchant = merchantToast.begin;

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    const created = cardRef.current;
    if (!created) return;
    finishedRef.current = true;
    setPhase("done");
    finishedCb.current(created);
  }, []);

  const runMerchant = addMerchant.run;
  useEffect(() => {
    if (phase !== "merchants") return;
    const card = cardRef.current;
    if (!card) return;
    const merchants = activeRef.current?.merchants ?? [];
    if (merchantIndex >= merchants.length) {
      finish();
      return;
    }
    if (startedRef.current === merchantIndex) return;
    startedRef.current = merchantIndex;
    beginMerchant(merchantLabel(merchants, merchantIndex));
    void runMerchant({ card, merchant: merchants[merchantIndex] });
  }, [phase, merchantIndex, finish, runMerchant, beginMerchant]);

  const runCreate = create.run;
  const start = useCallback(() => {
    const current = draftRef.current;
    if (!current || finishedRef.current) return;
    // A retry after a failed create keeps the salt (and therefore the
    // address) of the first attempt, even if the owner walked back and
    // edited the policy in between: the salt query may have refetched, and
    // deploying at a different index would contradict the address the
    // confirm step has been showing all along.
    const frozen = activeRef.current;
    const next = frozen ? { ...current, salt: frozen.salt, address: frozen.address } : current;
    activeRef.current = next;
    setAddress(next.address);
    setPhase("card");
    beginCreate(`Create card ${next.label}`);
    void runCreate(next);
  }, [runCreate, beginCreate]);

  const retryMerchant = useCallback(() => {
    const card = cardRef.current;
    const merchants = activeRef.current?.merchants ?? [];
    if (!card || merchantIndex >= merchants.length) return;
    beginMerchant(merchantLabel(merchants, merchantIndex));
    void runMerchant({ card, merchant: merchants[merchantIndex] });
  }, [merchantIndex, runMerchant, beginMerchant]);

  // Whichever transaction the status box is about: the merchant one while
  // it is running, the card one before the first merchant starts (and when
  // there are no merchants at all), so the hash on screen is never blank.
  const active = addMerchant.state === "idle" ? create : addMerchant;
  // In the gap between the card confirming and the first `add_merchant`
  // being prepared, the merchant action is still `idle` — the card
  // transaction is what just confirmed, so that is what the status shows.
  const state: ActionState =
    phase === "done"
      ? "confirmed"
      : phase === "merchants"
        ? addMerchant.state === "idle"
          ? "confirmed"
          : addMerchant.state
        : create.state;

  // Nothing reached the network: `useContractAction` only sets a hash once
  // `sendTransaction` has answered, so a `failed` card phase with no hash is
  // a declined signature or a failed simulation — no card exists.
  const createAborted = phase === "card" && create.state === "failed" && create.hash === null;

  return {
    phase,
    address,
    merchantIndex,
    state,
    hash: active.hash,
    error: active.error,
    details: active.details,
    busy: state !== "failed" && (phase === "card" || phase === "merchants"),
    locked: phase !== "idle" && !createAborted,
    start,
    retryMerchant,
    skipMerchants: finish,
  };
}
