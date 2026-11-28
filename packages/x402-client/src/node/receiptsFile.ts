import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Receipt } from "../receipts.js";

const LEDGER = "receipts.jsonl";

/** The CSV columns, in order. */
export const RECEIPT_CSV_COLUMNS = [
  "id",
  "ts",
  "protocol",
  "card",
  "agent",
  "payTo",
  "amount",
  "asset",
  "network",
  "url",
  "status",
  "txHash",
  "reason",
  "sig",
] as const;

export interface ReceiptFilter {
  /** ISO instant; receipts at or after it. */
  since?: string;
  card?: string;
}

/**
 * Appends one receipt as a JSON line to `<stateDir>/receipts.jsonl`,
 * creating the directory first. Synchronous, so it can be passed as
 * `pay()`'s `onReceipt`.
 */
export function appendReceipt(stateDir: string, r: Receipt): void {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(path.join(stateDir, LEDGER), `${JSON.stringify(r)}\n`);
}

/**
 * The ledger's receipts in file order, filtered by `since` and `card`.
 * No ledger yet is `[]`; blank lines are skipped; a line that is not a JSON
 * object throws with its line number.
 */
export function readReceipts(stateDir: string, filter: ReceiptFilter = {}): Receipt[] {
  const file = path.join(stateDir, LEDGER);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let since: number | undefined;
  if (filter.since !== undefined) {
    since = Date.parse(filter.since);
    if (Number.isNaN(since)) throw new RangeError(`since: "${filter.since}" is not an ISO date`);
  }
  const out: Receipt[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let r: unknown;
    try {
      r = JSON.parse(line);
    } catch {
      throw new Error(`${file}:${i + 1}: malformed receipt line`);
    }
    if (r === null || typeof r !== "object" || Array.isArray(r)) {
      throw new Error(`${file}:${i + 1}: malformed receipt line`);
    }
    const receipt = r as Receipt;
    if (filter.card !== undefined && receipt.card !== filter.card) return;
    if (since !== undefined && !(Date.parse(receipt.ts) >= since)) return;
    out.push(receipt);
  });
  return out;
}

/** RFC 4180: quote a field holding a comma, a quote or a line break; double inner quotes. */
function csvField(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The ledger as CSV (RFC 4180, CRLF line ends, fixed header, empty fields
 * for absent optional values) or as a pretty-printed JSON array.
 */
export function exportReceipts(
  stateDir: string,
  opts: { format: "csv" | "json" } & ReceiptFilter,
): string {
  const receipts = readReceipts(stateDir, { since: opts.since, card: opts.card });
  if (opts.format === "json") return JSON.stringify(receipts, null, 2);
  const lines = [RECEIPT_CSV_COLUMNS.join(",")];
  for (const r of receipts) lines.push(RECEIPT_CSV_COLUMNS.map((c) => csvField(r[c])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
