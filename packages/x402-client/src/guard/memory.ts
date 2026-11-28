import type { GuardDenied } from "../denial.js";
import { receiptId } from "../receipts.js";
import { COMMITTED_KEEP, decideGuard, utcDay } from "./decide.js";
import type { Guard, GuardCaps, GuardSnapshot, GuardTerms, Reservation } from "./types.js";

interface CardState {
  day: string;
  daily: bigint;
  total: bigint;
  reservations: Map<string, bigint>;
  /** Ids of recent settled commits (insertion order, at most `COMMITTED_KEEP`), so a repeat does not count twice. */
  committed: Set<string>;
  stopped?: { reason?: string };
}

/**
 * An in-process `Guard`: per-card state held in memory, lost on restart.
 *
 * Decisions are synchronous between the check and the reservation, so
 * concurrent payments on one event loop cannot both pass a cap they would
 * jointly exceed. "Day" is the UTC date of `now()`; on a new day `daily`
 * starts at 0 while open reservations are kept and still count toward both
 * caps.
 */
export class MemoryGuard implements Guard {
  private readonly cards = new Map<string, CardState>();
  private globalStop?: { reason?: string };

  constructor(
    private readonly caps: GuardCaps = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  private state(card: string): CardState {
    const day = utcDay(this.now());
    let s = this.cards.get(card);
    if (!s) {
      s = { day, daily: 0n, total: 0n, reservations: new Map(), committed: new Set() };
      this.cards.set(card, s);
    } else if (s.day !== day) {
      s.day = day;
      s.daily = 0n;
    }
    return s;
  }

  private static reserved(s: CardState): bigint {
    let sum = 0n;
    for (const v of s.reservations.values()) sum += v;
    return sum;
  }

  private decide(t: GuardTerms): { denied: GuardDenied | null; state: CardState; amount: bigint } {
    const s = this.state(t.card);
    const counters = { day: s.day, daily: s.daily, total: s.total, reserved: MemoryGuard.reserved(s) };
    const denied = decideGuard(t, this.caps, counters, this.globalStop ?? s.stopped);
    return { denied, state: s, amount: BigInt(t.amount) };
  }

  async check(t: GuardTerms): Promise<GuardDenied | null> {
    return this.decide(t).denied;
  }

  async reserve(t: GuardTerms): Promise<Reservation> {
    const { denied, state, amount } = this.decide(t);
    if (denied) throw denied;
    const id = receiptId();
    state.reservations.set(id, amount);
    return { id, card: t.card, amount: amount.toString() };
  }

  async commit(r: Reservation, outcome: "settled" | "denied" | "failed"): Promise<void> {
    const s = this.state(r.card);
    const held = s.reservations.get(r.id);
    s.reservations.delete(r.id);
    // A settled payment always counts, even when its reservation is unknown;
    // a repeated settled commit of the same id does not count twice.
    if (outcome !== "settled" || s.committed.has(r.id)) return;
    const amount = held ?? BigInt(r.amount);
    s.daily += amount;
    s.total += amount;
    s.committed.add(r.id);
    if (s.committed.size > COMMITTED_KEEP) s.committed.delete(s.committed.values().next().value!);
  }

  async stop(reason?: string, card?: string): Promise<void> {
    if (card === undefined) this.globalStop = { reason };
    else this.state(card).stopped = { reason };
  }

  async resume(card?: string): Promise<void> {
    if (card === undefined) this.globalStop = undefined;
    else this.state(card).stopped = undefined;
  }

  async isStopped(card: string): Promise<boolean> {
    return this.globalStop !== undefined || this.cards.get(card)?.stopped !== undefined;
  }

  async snapshot(card: string): Promise<GuardSnapshot> {
    const s = this.state(card);
    return {
      day: s.day,
      daily: s.daily.toString(),
      total: s.total.toString(),
      reserved: MemoryGuard.reserved(s).toString(),
      caps: { ...this.caps },
      stopped: await this.isStopped(card),
    };
  }
}
