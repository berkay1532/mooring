import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { formatUsdc, parseGuardConfig, verifyReceipt, type Receipt } from "@mooring-live/x402-client";
import type { CliDeps } from "./index.js";

/** Reads a receipt ledger in JSONL form: one receipt per line, blank lines skipped. */
function readJsonl(file: string): Receipt[] {
  const out: Receipt[] = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        out.push(JSON.parse(line) as Receipt);
      } catch {
        throw new Error(`${file}:${i + 1}: not a JSON receipt`);
      }
    });
  return out;
}

/** `Label:` padded so the values line up. */
function row(label: string, value: string): string {
  return `${`${label}:`.padEnd(14)}${value}`;
}

const usdc = (baseUnits: string | undefined): string => (baseUnits === undefined ? "none" : `${formatUsdc(baseUnits)} USDC`);

/**
 * `stop`, `resume`, `guard` and `receipts export|verify`: the local guard's
 * stop switch, its per-card counters and the signed receipt ledger, all under
 * the state directory (`$MOORING_HOME`, else `~/.mooring`).
 */
export function registerGuardCommands(program: Command, deps: CliDeps): void {
  program
    .command("stop")
    .description("Stop every payment (or one card's) before the agent key signs anything")
    .option("--reason <text>", "why, recorded in the stop file")
    .option("--card <address>", "stop only this card (C...)")
    .action(async (opts: { reason?: string; card?: string }) => {
      const stateDir = deps.stateDir();
      // The stop switch must work even when the caps config is broken.
      await deps.guardFor(stateDir, {}).stop(opts.reason, opts.card);
      deps.stdout(`stopped (${path.join(stateDir, "stop")})`);
    });

  program
    .command("resume")
    .description("Lift the global stop (or one card's)")
    .option("--card <address>", "resume only this card (C...)")
    .action(async (opts: { card?: string }) => {
      await deps.guardFor(deps.stateDir(), {}).resume(opts.card);
      deps.stdout("resumed");
    });

  program
    .command("guard")
    .description("Print a card's local guard state: today's and total spend, open reservations, caps, stop")
    .requiredOption("--card <address>", "card contract address (C...)")
    .option("--json", "print the raw snapshot (base units) as JSON")
    .action(async (opts: { card: string; json?: boolean }) => {
      let caps;
      try {
        caps = parseGuardConfig(deps.loadGuardConfig(deps.cwd(), deps.env));
      } catch (err) {
        deps.stdout(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }
      const s = await deps.guardFor(deps.stateDir(), caps).snapshot(opts.card);
      if (opts.json) {
        deps.stdout(JSON.stringify(s, null, 2));
        return;
      }
      deps.stdout(row("Card", opts.card));
      deps.stdout(row("Day", s.day));
      deps.stdout(row("Spent today", usdc(s.daily)));
      deps.stdout(row("Spent total", usdc(s.total)));
      deps.stdout(row("Reserved", usdc(s.reserved)));
      deps.stdout(row("Daily cap", usdc(s.caps.dailyCap)));
      deps.stdout(row("Total cap", usdc(s.caps.totalCap)));
      deps.stdout(row("Max per tx", usdc(s.caps.maxPerTx)));
      deps.stdout(row("Stopped", s.stopped ? "yes" : "no"));
    });

  const receipts = program.command("receipts").description("Export or verify the signed receipt ledger");

  receipts
    .command("export")
    .description("Write the receipt ledger to stdout as CSV or JSON")
    .option("--csv", "CSV, header first")
    .option("--json", "a JSON array")
    .option("--since <iso>", "only receipts at or after this ISO instant")
    .option("--card <address>", "only this card's receipts (C...)")
    .action((opts: { csv?: boolean; json?: boolean; since?: string; card?: string }) => {
      if (Boolean(opts.csv) === Boolean(opts.json)) {
        deps.stdout("receipts export: pass exactly one of --csv or --json");
        process.exitCode = 1;
        return;
      }
      const text = deps.exportReceipts(deps.stateDir(), {
        format: opts.csv ? "csv" : "json",
        ...(opts.since !== undefined ? { since: opts.since } : {}),
        ...(opts.card !== undefined ? { card: opts.card } : {}),
      });
      // `stdout` ends the line itself.
      deps.stdout(text.replace(/\r?\n$/, ""));
    });

  receipts
    .command("verify")
    .description("Check every receipt's agent signature (default: the ledger in the state directory)")
    .argument("[file]", "a receipts JSONL file to verify instead of the ledger")
    .action((file: string | undefined) => {
      const list = file === undefined ? deps.readReceipts(deps.stateDir()) : readJsonl(file);
      const bad = list.filter((r) => !verifyReceipt(r));
      if (bad.length === 0) {
        deps.stdout(`verified ${list.length} receipts`);
        return;
      }
      for (const r of bad) deps.stdout(`bad signature: ${r.id}`);
      process.exitCode = 1;
    });
}
