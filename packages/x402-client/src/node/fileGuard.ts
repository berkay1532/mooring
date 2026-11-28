import { promises as fs } from "node:fs";
import path from "node:path";
import { decideGuard, utcDay, type GuardCounters } from "../guard/decide.js";
import type { GuardDenied } from "../denial.js";
import type { Guard, GuardCaps, GuardSnapshot, GuardTerms, Reservation } from "../guard/types.js";
import { receiptId } from "../receipts.js";
import { withLock } from "./lock.js";

/** A reservation older than this was left by a crashed process and no longer counts. */
export const RESERVATION_TTL_MS = 10 * 60_000;

interface CardRecord {
  day: string;
  daily: string;
  total: string;
  reservations: Record<string, { amount: string; at: string }>;
}

interface SpendFile {
  v: 1;
  cards: Record<string, CardRecord>;
}

/**
 * The `stop` file. Without `cards` it is a global stop; with `cards` it stops
 * those cards, plus every card when `global` is true (a global stop set on top
 * of card-scoped ones).
 */
interface StopFile {
  at: string;
  reason?: string;
  cards?: string[];
  global?: true;
}

/** A stop file as read: `global` also covers an unreadable or unparseable file. */
interface StopState {
  global: boolean;
  reason?: string;
  cards: string[];
}

export interface FileGuardOptions {
  stateDir: string;
  /** Local caps in base units; absent caps do not limit. */
  caps?: GuardCaps;
  now?: () => Date;
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException)?.code === code;
}

/** Write-then-rename, so a reader never sees a half-written file. */
async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${receiptId()}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

/**
 * A `Guard` whose state lives in files under `stateDir`, so every process
 * using the same directory (the CLI, an agent, an MCP server) shares one set
 * of counters and one stop switch.
 *
 * - `spend.json`: `{ v: 1, cards: { [card]: { day, daily, total, reservations: { [id]: { amount, at } } } } }`.
 *   A record from an earlier UTC day is read with `daily` at `"0"` (`total`
 *   kept); reservations older than 10 minutes are dropped on read.
 * - `stop`: `{ at, reason?, cards? }`; without `cards` every card is stopped.
 *   A `stop` file that exists but cannot be read or parsed stops every card.
 *
 * Every read-modify-write runs under `withLock(stateDir)`. Decisions are the
 * ones `MemoryGuard` makes (`decideGuard`).
 */
export function fileGuard(opts: FileGuardOptions): Guard {
  const { stateDir } = opts;
  const caps: GuardCaps = { ...(opts.caps ?? {}) };
  const now = opts.now ?? (() => new Date());
  const spendPath = path.join(stateDir, "spend.json");
  const stopPath = path.join(stateDir, "stop");

  async function readSpend(): Promise<SpendFile> {
    let text: string;
    try {
      text = await fs.readFile(spendPath, "utf8");
    } catch (err) {
      if (isErrno(err, "ENOENT")) return { v: 1, cards: {} };
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const p = parsed as Partial<SpendFile> | undefined;
    if (!p || p.v !== 1 || p.cards === null || typeof p.cards !== "object") {
      // Fail closed: a corrupt ledger must not silently reset the counters.
      throw new Error(`${spendPath}: unreadable guard state; fix or remove it`);
    }
    return p as SpendFile;
  }

  /** The card's record as of `now()`: rolled to today, stale reservations dropped. */
  function current(file: SpendFile, card: string): CardRecord {
    const at = now();
    const day = utcDay(at);
    const rec: CardRecord = file.cards[card] ?? { day, daily: "0", total: "0", reservations: {} };
    if (rec.day < day) {
      rec.day = day;
      rec.daily = "0";
    }
    const reservations: CardRecord["reservations"] = {};
    for (const [id, r] of Object.entries(rec.reservations ?? {})) {
      if (at.getTime() - Date.parse(r.at) <= RESERVATION_TTL_MS) reservations[id] = r;
    }
    rec.reservations = reservations;
    file.cards[card] = rec;
    return rec;
  }

  function counters(rec: CardRecord): GuardCounters {
    let reserved = 0n;
    for (const r of Object.values(rec.reservations)) reserved += BigInt(r.amount);
    return { day: rec.day, daily: BigInt(rec.daily), total: BigInt(rec.total), reserved };
  }

  /** `null` when there is no stop file. */
  async function readStop(): Promise<StopState | null> {
    let text: string;
    try {
      text = await fs.readFile(stopPath, "utf8");
    } catch (err) {
      if (isErrno(err, "ENOENT")) return null;
      // Present but unreadable: stopped.
      return { global: true, cards: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { global: true, cards: [] };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { global: true, cards: [] };
    const s = parsed as Partial<StopFile>;
    const reason = typeof s.reason === "string" ? s.reason : undefined;
    if (s.cards === undefined) return { global: true, reason, cards: [] };
    if (!Array.isArray(s.cards) || !s.cards.every((c) => typeof c === "string")) {
      return { global: true, reason, cards: [] };
    }
    return { global: s.global === true, reason, cards: s.cards };
  }

  async function writeStop(s: StopState): Promise<void> {
    if (!s.global && s.cards.length === 0) {
      await fs.rm(stopPath, { force: true });
      return;
    }
    const file: StopFile = { at: now().toISOString() };
    if (s.reason !== undefined) file.reason = s.reason;
    if (s.cards.length > 0) {
      file.cards = s.cards;
      if (s.global) file.global = true;
    }
    await writeAtomic(stopPath, `${JSON.stringify(file, null, 2)}\n`);
  }

  function stopFor(s: StopState | null, card: string): { reason?: string } | undefined {
    if (!s) return undefined;
    return s.global || s.cards.includes(card) ? { reason: s.reason } : undefined;
  }

  async function decide(t: GuardTerms, file: SpendFile): Promise<{ denied: GuardDenied | null; rec: CardRecord }> {
    const rec = current(file, t.card);
    const denied = decideGuard(t, caps, counters(rec), stopFor(await readStop(), t.card));
    return { denied, rec };
  }

  return {
    async check(t) {
      return (await decide(t, await readSpend())).denied;
    },

    async reserve(t): Promise<Reservation> {
      return withLock(stateDir, async () => {
        const file = await readSpend();
        const { denied, rec } = await decide(t, file);
        if (denied) throw denied;
        const amount = BigInt(t.amount).toString();
        const id = receiptId();
        rec.reservations[id] = { amount, at: now().toISOString() };
        await writeAtomic(spendPath, JSON.stringify(file));
        return { id, card: t.card, amount };
      });
    },

    async commit(r, outcome) {
      await withLock(stateDir, async () => {
        const file = await readSpend();
        const rec = current(file, r.card);
        const held = rec.reservations[r.id];
        // Unknown, expired or already committed: nothing to do.
        if (held === undefined) return;
        delete rec.reservations[r.id];
        if (outcome === "settled") {
          const amount = BigInt(held.amount);
          rec.daily = (BigInt(rec.daily) + amount).toString();
          rec.total = (BigInt(rec.total) + amount).toString();
        }
        await writeAtomic(spendPath, JSON.stringify(file));
      });
    },

    async stop(reason, card) {
      await withLock(stateDir, async () => {
        const s = (await readStop()) ?? { global: false, cards: [] };
        const next: StopState = { global: s.global, reason: reason ?? s.reason, cards: [...s.cards] };
        if (card === undefined) next.global = true;
        else if (!next.cards.includes(card)) next.cards.push(card);
        await writeStop(next);
      });
    },

    async resume(card) {
      await withLock(stateDir, async () => {
        const s = await readStop();
        if (!s) return;
        if (card === undefined) await writeStop({ ...s, global: false });
        else await writeStop({ ...s, cards: s.cards.filter((c) => c !== card) });
      });
    },

    async isStopped(card) {
      return stopFor(await readStop(), card) !== undefined;
    },

    async snapshot(card): Promise<GuardSnapshot> {
      const rec = current(await readSpend(), card);
      const c = counters(rec);
      return {
        day: rec.day,
        daily: c.daily.toString(),
        total: c.total.toString(),
        reserved: c.reserved.toString(),
        caps: { ...caps },
        stopped: stopFor(await readStop(), card) !== undefined,
      };
    },
  };
}
