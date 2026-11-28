import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryGuard, signReceipt, type GuardCaps, type Receipt } from "@mooring-live/x402-client";
import { fileGuard } from "@mooring-live/x402-client/node";
import { buildProgram } from "../src/index.js";

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const agent = Keypair.random();

function receipt(id: string): Receipt {
  return signReceipt(
    {
      v: 1,
      id,
      ts: "2026-11-28T10:00:00.000Z",
      protocol: "mpp",
      card: CARD,
      agent: agent.publicKey(),
      payTo: "GPAYTO",
      amount: "10000",
      asset: "CUSDC",
      network: "stellar:testnet",
      status: "settled",
      txHash: "cafe",
    },
    agent,
  );
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "mooring-cli-"));
  process.exitCode = undefined;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

function deps(out: string[], extra: Record<string, unknown> = {}) {
  return {
    stdout: (s: string) => out.push(s),
    env: {},
    cwd: () => dir,
    stateDir: () => dir,
    loadGuardConfig: vi.fn(() => ({})),
    guardFor: vi.fn((stateDir: string, caps: GuardCaps) => fileGuard({ stateDir, caps })),
    readReceipts: vi.fn(() => []),
    exportReceipts: vi.fn(() => ""),
    ...extra,
  } as never;
}

describe("mooring stop / resume", () => {
  it("mooring stop writes the stop file and mooring resume removes it", async () => {
    const out: string[] = [];
    await buildProgram(deps(out)).parseAsync(["node", "mooring", "stop", "--reason", "runaway loop"]);
    expect(out).toEqual([`stopped (${path.join(dir, "stop")})`]);
    expect(existsSync(path.join(dir, "stop"))).toBe(true);
    expect(await fileGuard({ stateDir: dir }).isStopped(CARD)).toBe(true);

    await buildProgram(deps(out)).parseAsync(["node", "mooring", "resume"]);
    expect(out[1]).toBe("resumed");
    expect(existsSync(path.join(dir, "stop"))).toBe(false);
    expect(await fileGuard({ stateDir: dir }).isStopped(CARD)).toBe(false);
  });

  it("--card scopes the stop to one card", async () => {
    const out: string[] = [];
    await buildProgram(deps(out)).parseAsync(["node", "mooring", "stop", "--card", CARD]);
    const g = fileGuard({ stateDir: dir });
    expect(await g.isStopped(CARD)).toBe(true);
    expect(await g.isStopped("COTHER")).toBe(false);
    await buildProgram(deps(out)).parseAsync(["node", "mooring", "resume", "--card", CARD]);
    expect(await g.isStopped(CARD)).toBe(false);
  });
});

describe("mooring guard", () => {
  it("prints the snapshot as a table with the configured caps", async () => {
    const out: string[] = [];
    const guard = new MemoryGuard({ dailyCap: "50000000", maxPerTx: "10000" });
    const r = await guard.reserve({ card: CARD, payTo: "GX", amount: "10000", asset: "CUSDC", network: "stellar:testnet" });
    await guard.commit(r, "settled");
    await guard.stop("x", CARD);
    const guardFor = vi.fn(() => guard);
    const loadGuardConfig = vi.fn(() => ({ dailyCap: "5", maxPerTx: "0.001" }));
    await buildProgram(deps(out, { guardFor, loadGuardConfig })).parseAsync(["node", "mooring", "guard", "--card", CARD]);
    expect(guardFor).toHaveBeenCalledWith(dir, { dailyCap: "50000000", maxPerTx: "10000" });
    const day = new Date().toISOString().slice(0, 10);
    expect(out).toEqual([
      `Card:         ${CARD}`,
      `Day:          ${day}`,
      "Spent today:  0.001 USDC",
      "Spent total:  0.001 USDC",
      "Reserved:     0 USDC",
      "Daily cap:    5 USDC",
      "Total cap:    none",
      "Max per tx:   0.001 USDC",
      "Stopped:      yes",
    ]);
  });

  it("--json prints the raw snapshot", async () => {
    const out: string[] = [];
    const guard = new MemoryGuard({});
    await buildProgram(deps(out, { guardFor: () => guard })).parseAsync(["node", "mooring", "guard", "--card", CARD, "--json"]);
    expect(JSON.parse(out.join(""))).toEqual(await guard.snapshot(CARD));
  });
});

describe("mooring receipts", () => {
  it("mooring receipts export --csv prints the header first", async () => {
    const out: string[] = [];
    const exportReceipts = vi.fn(() => "id,ts,protocol\r\nr1,2026,mpp\r\n");
    await buildProgram(deps(out, { exportReceipts })).parseAsync([
      "node", "mooring", "receipts", "export", "--csv", "--since", "2026-11-01T00:00:00Z", "--card", CARD,
    ]);
    expect(exportReceipts).toHaveBeenCalledWith(dir, { format: "csv", since: "2026-11-01T00:00:00Z", card: CARD });
    expect(out[0]!.split("\r\n")[0]).toBe("id,ts,protocol");
    expect(out).toEqual(["id,ts,protocol\r\nr1,2026,mpp"]);
  });

  it("export --json passes the json format", async () => {
    const out: string[] = [];
    const exportReceipts = vi.fn(() => "[]");
    await buildProgram(deps(out, { exportReceipts })).parseAsync(["node", "mooring", "receipts", "export", "--json"]);
    expect(exportReceipts).toHaveBeenCalledWith(dir, { format: "json" });
    expect(out).toEqual(["[]"]);
  });

  it.each([[[]], [["--csv", "--json"]]])("export needs exactly one of --csv / --json (%j)", async (flags) => {
    const out: string[] = [];
    const exportReceipts = vi.fn();
    await buildProgram(deps(out, { exportReceipts })).parseAsync(["node", "mooring", "receipts", "export", ...flags]);
    expect(out).toEqual(["receipts export: pass exactly one of --csv or --json"]);
    expect(process.exitCode).toBe(1);
    expect(exportReceipts).not.toHaveBeenCalled();
  });

  it("mooring receipts verify verifies the ledger by default", async () => {
    const out: string[] = [];
    const readReceipts = vi.fn(() => [receipt("a"), receipt("b")]);
    await buildProgram(deps(out, { readReceipts })).parseAsync(["node", "mooring", "receipts", "verify"]);
    expect(readReceipts).toHaveBeenCalledWith(dir);
    expect(out).toEqual(["verified 2 receipts"]);
    expect(process.exitCode).toBeUndefined();
  });

  it("mooring receipts verify exits 1 when a signature does not verify", async () => {
    const out: string[] = [];
    const good = receipt("good");
    const bad = { ...receipt("bad"), amount: "99999999" };
    const file = path.join(dir, "other.jsonl");
    writeFileSync(file, `${JSON.stringify(good)}\n\n${JSON.stringify(bad)}\n`);
    const readReceipts = vi.fn();
    await buildProgram(deps(out, { readReceipts })).parseAsync(["node", "mooring", "receipts", "verify", file]);
    expect(readReceipts).not.toHaveBeenCalled();
    expect(out).toEqual(["bad signature: bad"]);
    expect(process.exitCode).toBe(1);
  });
});
