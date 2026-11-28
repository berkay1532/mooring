import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import {
  Address,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { FacilitatorClient } from "@x402/core/server";
import { afterEach, describe, expect, it } from "vitest";
import { createSellerApp } from "../../../apps/seller/src/app.js";
import type { ChargeRpc } from "../../../apps/seller/src/mpp-card-charge.js";
import { scaffold } from "../src/scaffold.js";

const run = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const ROOT = path.resolve(PKG, "../..");
const TEMPLATE = path.join(PKG, "template");
const SHIM = pathToFileURL(path.join(HERE, "fixtures/rpc-shim.mjs")).href;

const CARD = "CAJPWJBFBM6WMYZBRURA7VW3GKSLMHTHIIZIRFVFKUSAPWX4526YAHCJ";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAY_TO = "GAW3KSJBGKNWH4LMUQRXBCSAUL4YUAF4LEHMONMDXFBMA3I524NXLOIG";
const OWNER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const PASSPHRASE = "Test SDF Network ; September 2015";
const TX_HASH = "ab".repeat(32);
const LATEST_LEDGER = 1000;

const temps: string[] = [];
const servers: Server[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Links the workspace client (built) and the template's other dependencies into `dir/node_modules`. */
function linkDeps(dir: string): void {
  const links: Array<[string, string]> = [
    ["@mooring-live/x402-client", path.join(ROOT, "packages/x402-client")],
    ["@stellar/stellar-sdk", path.join(ROOT, "node_modules/@stellar/stellar-sdk")],
    ["dotenv", path.join(ROOT, "node_modules/dotenv")],
    ["@types/node", path.join(ROOT, "node_modules/@types/node")],
  ];
  for (const [name, target] of links) {
    const at = path.join(dir, "node_modules", name);
    mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(target, at, "dir");
  }
}

async function scaffoldInto(dir: string, service = "https://api.mooring.live/quote"): Promise<string[]> {
  return scaffold({ dir, name: "my-agent", service, network: "stellar:testnet", templateDir: TEMPLATE });
}

describe("scaffold", () => {
  it("scaffolds the template with substitutions and refuses a non-empty dir", async () => {
    const dir = path.join(tempDir("kit-"), "my-agent");
    const written = await scaffoldInto(dir);

    expect([...written].sort()).toEqual(
      [".env.example", ".gitignore", "README.md", "package.json", "src/agent.ts", "src/config.ts", "src/status.ts", "tsconfig.json"].sort(),
    );
    const env = readFileSync(path.join(dir, ".env.example"), "utf8");
    expect(env).toContain("MOORING_SERVICE=https://api.mooring.live/quote");
    expect(env).toContain("MOORING_NETWORK=stellar:testnet");
    expect(env).toMatch(/^MOORING_CARD=$/m);
    expect(env).toMatch(/^AGENT_SECRET=$/m);
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-agent");
    expect(pkg.scripts).toMatchObject({ pay: "tsx src/agent.ts", status: "tsx src/status.ts" });
    const readme = readFileSync(path.join(dir, "README.md"), "utf8");
    expect(readme).toContain("# my-agent");
    for (const file of ["package.json", ".env.example", "README.md"]) {
      expect(readFileSync(path.join(dir, file), "utf8")).not.toMatch(/__(NAME|SERVICE|NETWORK)__/);
    }
    expect(readFileSync(path.join(dir, ".gitignore"), "utf8").split("\n")).toEqual(
      expect.arrayContaining([".env", "node_modules", ".mooring/"]),
    );

    // An empty existing directory is fine; a non-empty one is refused untouched.
    const empty = tempDir("kit-empty-");
    await expect(scaffoldInto(empty)).resolves.toHaveLength(written.length);
    const busy = tempDir("kit-busy-");
    writeFileSync(path.join(busy, "keep.txt"), "mine");
    await expect(scaffoldInto(busy)).rejects.toThrow("directory is not empty");
    expect(existsSync(path.join(busy, "package.json"))).toBe(false);
  });

  it("the scaffolded project typechecks against the workspace client", async () => {
    const dir = path.join(tempDir("kit-tsc-"), "my-agent");
    await scaffoldInto(dir);
    linkDeps(dir);
    const tsc = path.join(ROOT, "node_modules/typescript/bin/tsc");
    const result = await run(process.execPath, [tsc, "--noEmit", "-p", path.join(dir, "tsconfig.json")], {
      cwd: dir,
    }).catch((err: { stdout?: string; stderr?: string }) => {
      throw new Error(`tsc failed:\n${err.stdout ?? ""}${err.stderr ?? ""}`);
    });
    expect(result.stdout).toBe("");
  }, 120_000);

  it("agent.ts pays an in-process seller and prints the hash", async () => {
    const rpcPort = await listen(createServer(rpcResponder));
    const sellerPort = await startSeller();

    const dir = path.join(tempDir("kit-e2e-"), "my-agent");
    await scaffoldInto(dir, `http://127.0.0.1:${sellerPort}/quote`);
    linkDeps(dir);
    const home = path.join(tempDir("kit-home-"), "state");

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of ["MOORING_DAILY_CAP", "MOORING_TOTAL_CAP", "MOORING_MAX_PER_TX", "MOORING_NETWORK"]) delete env[k];
    const tsx = path.join(ROOT, "node_modules/tsx/dist/cli.mjs");
    const { stdout } = await run(process.execPath, [tsx, "src/agent.ts"], {
      cwd: dir,
      timeout: 60_000,
      env: {
        ...env,
        MOORING_CARD: CARD,
        // A throwaway key for this test only.
        AGENT_SECRET: Keypair.random().secret(),
        MOORING_SERVICE: `http://127.0.0.1:${sellerPort}/quote`,
        MOORING_HOME: home,
        MOORING_RPC_URL: "https://rpc.mooring.test",
        MOORING_TEST_RPC_TARGET: `http://127.0.0.1:${rpcPort}`,
        NODE_OPTIONS: `--import ${SHIM}`,
      },
    }).catch((err: { stdout?: string; stderr?: string; code?: number }) => {
      throw new Error(`agent.ts exited ${err.code}:\n${err.stdout ?? ""}${err.stderr ?? ""}`);
    });

    expect(stdout).toContain(`Paid 0.001 USDC to ${PAY_TO} via x402`);
    expect(stdout).toContain(`tx ${TX_HASH} — https://stellar.expert/explorer/testnet/tx/${TX_HASH}`);
    expect(stdout).toContain("Remaining this period: 10 USDC");
    const receipts = path.join(home, "receipts.jsonl");
    expect(stdout).toMatch(new RegExp(`Receipt \\S+ → ${receipts.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const lines = readFileSync(receipts, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ status: "settled", txHash: TX_HASH, card: CARD, protocol: "x402" });
  }, 120_000);
});

// --- the in-process seller and RPC -----------------------------------------

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

/** A facilitator that verifies and settles every x402 payment with `TX_HASH`. */
const facilitator = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } }],
    extensions: [],
    signers: { "stellar:*": ["GFACILITATOR"] },
  }),
  verify: async () => ({ isValid: true }),
  settle: async () => ({ success: true, transaction: TX_HASH, network: "stellar:testnet" }),
} as unknown as FacilitatorClient;

/** The MPP leg is not exercised here (the service is the x402 `/quote`); every call fails loudly if it were. */
const chargeRpc: ChargeRpc = {
  simulate: async () => ({ ok: false, error: "not used in this test" }),
  send: async () => {
    throw new Error("not used in this test");
  },
  wait: async () => "NOT_FOUND",
  latestLedger: async () => LATEST_LEDGER,
};

function startSeller(): Promise<number> {
  const app = createSellerApp({
    network: "stellar:testnet",
    payTo: PAY_TO,
    usdc: USDC,
    rpcUrl: "https://soroban-testnet.stellar.org",
    facilitator,
    mppSecretKey: "test-secret-key-at-least-32-bytes-long!!",
    priceBaseUnits: "10000",
    rpc: chargeRpc,
  });
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => resolve(info.port));
    servers.push(server as unknown as Server);
  });
}

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const struct = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: sym(k), val: fields[k]! })),
  );
const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const u64 = (v: bigint) => nativeToScVal(v, { type: "u64" });
const addr = (a: string) => nativeToScVal(Address.fromString(a), { type: "address" });

/** The card's `info()`: active, 10 USDC left this period, 20 USDC held, PAY_TO allowlisted. */
const cardInfo = struct({
  allow_count: xdr.ScVal.scvU32(1),
  balance: i128(200_000_000n),
  label: xdr.ScVal.scvString("my-agent"),
  owner: addr(OWNER),
  period: struct({ spent: i128(0n), start: u64(1_789_000_000n) }),
  policy: struct({
    expiry: u64(4_000_000_000n),
    max_per_tx: i128(100_000_000n),
    period_amount: i128(100_000_000n),
    period_duration: u64(86_400n),
  }),
  remaining: i128(100_000_000n),
  signer: xdr.ScVal.scvBytes(Buffer.alloc(32, 7)),
  state: xdr.ScVal.scvU32(0),
  token: addr(USDC),
});

/** `InvokeContractArgs` as stellar-sdk 17 decodes it: plain fields. */
type InvokeArgs = { contractAddress: xdr.ScAddress; functionName: string | Uint8Array; args: xdr.ScVal[] };

/** The unsigned legacy (v1) auth entry a simulation records for `token.transfer(from, to, amount)`. */
function transferEntry(invoke: InvokeArgs): xdr.SorobanAuthorizationEntry {
  const [from, to, amount] = invoke.args.map((a) => scValToNative(a) as unknown);
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(String(from)).toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: invoke.contractAddress,
          functionName: "transfer",
          args: [addr(String(from)), addr(String(to)), i128(amount as bigint)],
        }),
      ),
      subInvocations: [],
    }),
  });
}

/** What `simulateTransaction` answers for the card's views and the USDC transfer. */
function simulate(txXdr: string): Record<string, unknown> {
  const tx = TransactionBuilder.fromXDR(txXdr, PASSPHRASE) as unknown as {
    operations: Array<{ func: { invokeContract: InvokeArgs } }>;
  };
  const invoke = tx.operations[0]!.func.invokeContract;
  const fn = invoke.functionName.toString();
  const base = {
    latestLedger: LATEST_LEDGER,
    minResourceFee: "100",
    transactionData: new SorobanDataBuilder().build().toXDR("base64"),
    events: [],
  };
  switch (fn) {
    case "info":
      return { ...base, results: [{ auth: [], xdr: cardInfo.toXDR("base64") }] };
    case "merchants":
      return { ...base, results: [{ auth: [], xdr: xdr.ScVal.scvVec([addr(PAY_TO)]).toXDR("base64") }] };
    case "transfer":
      return {
        ...base,
        results: [{ auth: [transferEntry(invoke).toXDR("base64")], xdr: xdr.ScVal.scvVoid().toXDR("base64") }],
      };
    default:
      return { latestLedger: LATEST_LEDGER, error: `unexpected contract call ${fn}` };
  }
}

/** A minimal Soroban JSON-RPC: the calls the client makes to pay over x402 and read the card. */
function rpcResponder(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const call = JSON.parse(body) as { id: unknown; method: string; params?: { transaction?: string } };
    const reply = (payload: Record<string, unknown>) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...payload }));
    };
    try {
      answer(call, reply);
    } catch (err) {
      // Answer, so a stub bug fails the agent fast instead of hanging it.
      reply({ error: { code: -32603, message: `rpc stub: ${err instanceof Error ? err.message : String(err)}` } });
    }
  });
}

function answer(
  call: { method: string; params?: { transaction?: string } },
  reply: (payload: Record<string, unknown>) => void,
): void {
  switch (call.method) {
    case "simulateTransaction":
      return reply({ result: simulate(call.params!.transaction!) });
    case "getLatestLedger":
      // stellar-sdk 17 decodes the header and close meta; all-zero XDR of the
      // right length (a v0 close meta) decodes to valid, empty values.
      return reply({
        result: {
          id: "00".repeat(32),
          protocolVersion: 23,
          sequence: LATEST_LEDGER,
          closeTime: "0",
          headerXdr: Buffer.alloc(324).toString("base64"),
          metadataXdr: Buffer.alloc(412).toString("base64"),
        },
      });
    case "getNetwork":
      return reply({ result: { passphrase: PASSPHRASE, protocolVersion: 23 } });
    default:
      return reply({ error: { code: -32601, message: `method not stubbed: ${call.method}` } });
  }
}
