import { GuardDenied } from "../denial.js";
import { receiptId } from "../receipts.js";
import { formatUsdc } from "./config.js";
import type { Guard, GuardCaps, GuardSnapshot, GuardTerms, Reservation } from "./types.js";

interface CardState {
  day: string;
  daily: bigint;
  total: bigint;
  reservations: Map<string, bigint>;
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
    const day = this.now().toISOString().slice(0, 10);
    let s = this.cards.get(card);
    if (!s) {
      s = { day, daily: 0n, total: 0n, reservations: new Map() };
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
    const amount = BigInt(t.amount);
    const attempted = formatUsdc(amount);
    const stop = this.globalStop ?? s.stopped;
    if (stop) {
      return {
        denied: new GuardDenied("stopped", { card: t.card, attempted, detail: stop.reason }),
        state: s,
        amount,
      };
    }
    const { maxPerTx, dailyCap, totalCap } = this.caps;
    if (maxPerTx !== undefined && amount > BigInt(maxPerTx)) {
      return {
        denied: new GuardDenied("max_per_tx", { card: t.card, attempted, limit: formatUsdc(maxPerTx) }),
        state: s,
        amount,
      };
    }
    const reserved = MemoryGuard.reserved(s);
    if (dailyCap !== undefined && s.daily + reserved + amount > BigInt(dailyCap)) {
      return {
        denied: new GuardDenied("daily_cap", {
          card: t.card,
          attempted,
          limit: formatUsdc(dailyCap),
          detail: `${formatUsdc(s.daily)} USDC spent on ${s.day}, ${formatUsdc(reserved)} USDC in flight`,
        }),
        state: s,
        amount,
      };
    }
    if (totalCap !== undefined && s.total + reserved + amount > BigInt(totalCap)) {
      return {
        denied: new GuardDenied("total_cap", {
          card: t.card,
          attempted,
          limit: formatUsdc(totalCap),
          detail: `${formatUsdc(s.total)} USDC spent in total, ${formatUsdc(reserved)} USDC in flight`,
        }),
        state: s,
        amount,
      };
    }
    return { denied: null, state: s, amount };
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
    const amount = s.reservations.get(r.id);
    // Unknown or already committed: nothing to do.
    if (amount === undefined) return;
    s.reservations.delete(r.id);
    if (outcome === "settled") {
      s.daily += amount;
      s.total += amount;
    }
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
