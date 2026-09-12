#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { getNetworkPassphrase, getRpcUrl } from "@x402/stellar";
import { Command } from "commander";
import {
  CardPolicyDenied,
  createMooringFetch,
  getSettlement,
  readCardInfo,
  readMerchants,
  type CardInfo,
  type Settlement,
  type StellarNetwork,
} from "@mooring/x402-client";

/** Everything `buildProgram` needs from the outside world; tests inject fakes. */
export interface CliDeps {
  readCardInfo: typeof readCardInfo;
  readMerchants: typeof readMerchants;
  createMooringFetch: typeof createMooringFetch;
  getSettlement: typeof getSettlement;
  stdout: (line: string) => void;
}

const realDeps: CliDeps = {
  readCardInfo,
  readMerchants,
  createMooringFetch,
  getSettlement,
  stdout: (line: string) => process.stdout.write(`${line}\n`),
};

/** JSON.stringify that renders bigints as strings and byte arrays as hex, instead of throwing or dumping index-keyed objects. */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v), 2);
}

/** Deep-converts every bigint to a string and every byte array to hex, for table/plain printing. */
function stringifyBigints(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(stringifyBigints);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stringifyBigints(v)]));
  }
  return value;
}

export function buildProgram(deps: CliDeps = realDeps): Command {
  const program = new Command();
  program
    .name("mooring")
    .description("CLI for Mooring spending cards (Soroban custom accounts on Stellar)")
    .version("0.1.0");

  program
    .command("keygen")
    .description("Generate a new agent keypair for a Mooring card signer")
    .option("--hex", "also print the 32-byte public key as hex, for `create_card --signer`")
    .action((opts: { hex?: boolean }) => {
      const kp = Keypair.random();
      deps.stdout(`Public key: ${kp.publicKey()}`);
      deps.stdout(`Secret key: ${kp.secret()}`);
      deps.stdout("WARNING: the secret key is shown once and never stored. Save it now (e.g. as AGENT_SECRET) — Mooring does not keep a copy.");
      if (opts.hex) {
        const hex = Buffer.from(kp.rawPublicKey()).toString("hex");
        deps.stdout(`Signer hex: ${hex}`);
      }
    });

  program
    .command("status")
    .description("Print a card's on-chain info and merchant allowlist")
    .requiredOption("--card <address>", "card contract address (C...)")
    .option("--network <network>", "stellar:testnet | stellar:pubnet", "stellar:testnet")
    .option("--rpc <url>", "override the default RPC URL for the network")
    .option("--json", "print machine-readable JSON instead of a table")
    .action(async (opts: { card: string; network: StellarNetwork; rpc?: string; json?: boolean }) => {
      const rpcUrl = getRpcUrl(opts.network, opts.rpc ? { url: opts.rpc } : undefined);
      const passphrase = getNetworkPassphrase(opts.network);
      const [info, merchants] = await Promise.all([
        deps.readCardInfo(rpcUrl, passphrase, opts.card),
        deps.readMerchants(rpcUrl, passphrase, opts.card),
      ]);
      if (opts.json) {
        deps.stdout(toJson({ info, merchants }));
        return;
      }
      deps.stdout(`Card: ${opts.card}`);
      deps.stdout(`Network: ${opts.network}`);
      deps.stdout("Info:");
      deps.stdout(toJson(stringifyBigints(info)));
      deps.stdout("Merchants:");
      deps.stdout(merchants.length ? merchants.map((m) => `  ${m}`).join("\n") : "  (none)");
    });

  program
    .command("pay")
    .description("Pay an x402-protected URL from a Mooring card")
    .argument("<url>", "the x402-protected URL to request")
    .requiredOption("--card <address>", "card contract address (C...)")
    .option("--agent-secret-env <name>", "env var holding the agent's Stellar secret key", "AGENT_SECRET")
    .option("--network <network>", "stellar:testnet | stellar:pubnet", "stellar:testnet")
    .option("--rpc <url>", "override the default RPC URL for the network")
    .option("--no-precheck", "skip the local policy pre-check before signing")
    .action(
      async (
        url: string,
        opts: {
          card: string;
          agentSecretEnv: string;
          network: StellarNetwork;
          rpc?: string;
          precheck: boolean;
        },
      ) => {
        const secretEnvName = opts.agentSecretEnv ?? "AGENT_SECRET";
        const secret = process.env[secretEnvName];
        if (!secret) {
          deps.stdout(`Missing agent secret: set ${secretEnvName} to the agent's Stellar secret key (S...).`);
          process.exitCode = 2;
          return;
        }
        const agent = Keypair.fromSecret(secret);
        const fetchWithPayment = deps.createMooringFetch({
          card: opts.card,
          agent,
          network: opts.network,
          rpcUrl: opts.rpc,
          precheck: opts.precheck,
        });

        try {
          const res = await fetchWithPayment(url);
          deps.stdout(`HTTP ${res.status}`);
          const settlement: Settlement | null = deps.getSettlement(res);
          if (settlement) {
            deps.stdout(`Settlement: ${settlement.transaction} (${settlement.network})`);
          }
          const body = await res.text();
          deps.stdout(body);
        } catch (err) {
          if (err instanceof CardPolicyDenied) {
            deps.stdout(`Denied (${err.reason}) at ${err.stage}`);
            process.exitCode = 2;
            return;
          }
          throw err;
        }
      },
    );

  return program;
}

// Re-exported so callers building `--json` output against `status` can type the result.
export type { CardInfo };

// Robust equivalent of `import.meta.url === \`file://${process.argv[1]}\``:
// resolves both sides to real filesystem paths so it works regardless of
// how the entrypoint was invoked (symlinked bin, relative path, etc.), and
// so it never runs `parseAsync` when the module is only imported by tests.
const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  void buildProgram().parseAsync(process.argv);
}
