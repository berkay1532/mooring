#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { getNetworkPassphrase, getRpcUrl } from "@x402/stellar";
import { Command, Option } from "commander";
import {
  CardPolicyDenied,
  DEFAULT_APP_URL,
  allowMerchantUrl,
  createCard,
  createMooringFetch,
  deploymentFor,
  getSettlement,
  nextCardIndex,
  readCardInfo,
  readMerchants,
  type CardInfo,
  type Settlement,
  type StellarNetwork,
} from "@mooring-live/x402-client";
import { buildPolicy } from "./create-args.js";

/** Everything `buildProgram` needs from the outside world; tests inject fakes. */
export interface CliDeps {
  readCardInfo: typeof readCardInfo;
  readMerchants: typeof readMerchants;
  createMooringFetch: typeof createMooringFetch;
  getSettlement: typeof getSettlement;
  createCard: typeof createCard;
  nextCardIndex: typeof nextCardIndex;
  stdout: (line: string) => void;
}

const realDeps: CliDeps = {
  readCardInfo,
  readMerchants,
  createMooringFetch,
  getSettlement,
  createCard,
  nextCardIndex,
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
    .version("0.3.1");

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
    .addOption(
      new Option("--network <network>", "stellar network").choices(["stellar:testnet", "stellar:pubnet"]).default("stellar:testnet"),
    )
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
      deps.stdout(`Label: ${info.label}`);
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
    .addOption(
      new Option("--network <network>", "stellar network").choices(["stellar:testnet", "stellar:pubnet"]).default("stellar:testnet"),
    )
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
        let agent: Keypair;
        try {
          agent = Keypair.fromSecret(secret);
        } catch {
          deps.stdout(`Invalid agent secret in $${secretEnvName}`);
          process.exitCode = 1;
          return;
        }
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
            if (err.merchant?.url) {
              deps.stdout(`Allow it: ${allowMerchantUrl(DEFAULT_APP_URL, opts.card, err.merchant.url)}`);
            }
            process.exitCode = 2;
            return;
          }
          throw err;
        }
      },
    );

  program
    .command("create")
    .description("Create a card through the factory, signed by the owner (OWNER_SECRET), at the next discoverable salt")
    .requiredOption("--label <text>", "card name shown in the app (1-32 bytes)")
    .requiredOption("--signer <key>", "the agent's public key (G... or 64 hex from `mooring keygen --hex`)")
    .requiredOption("--budget <usdc>", "spending budget per period, in USDC (e.g. 5 or 0.25)")
    .requiredOption("--period <duration>", "budget period: 1d, 12h, 30m or seconds")
    .option("--max-per-tx <usdc>", "cap for a single payment (default: the budget)")
    .option("--expiry <when>", "+30d, +12h or an ISO date (default +30d)")
    .option("--owner-secret-env <name>", "env var holding the owner's Stellar secret key", "OWNER_SECRET")
    .option("--salt <index>", "deployer salt index (default: the next unused one, so the app discovers the card)")
    .option("--factory <address>", "factory contract (default: the known deployment for --network)")
    .option("--token <address>", "token the card holds (default: the network's USDC SAC)")
    .addOption(
      new Option("--network <network>", "stellar network").choices(["stellar:testnet", "stellar:pubnet"]).default("stellar:testnet"),
    )
    .option("--rpc <url>", "override the default RPC URL for the network")
    .option("--json", "print machine-readable JSON")
    .action(
      async (opts: {
        label: string;
        signer: string;
        budget: string;
        period: string;
        maxPerTx?: string;
        expiry?: string;
        ownerSecretEnv: string;
        salt?: string;
        factory?: string;
        token?: string;
        network: StellarNetwork;
        rpc?: string;
        json?: boolean;
      }) => {
        const secretEnvName = opts.ownerSecretEnv ?? "OWNER_SECRET";
        const secret = process.env[secretEnvName];
        if (!secret) {
          deps.stdout(`Missing owner secret: set ${secretEnvName} to the card owner's Stellar secret key (S...).`);
          process.exitCode = 2;
          return;
        }
        let owner: Keypair;
        try {
          owner = Keypair.fromSecret(secret);
        } catch {
          deps.stdout(`Invalid owner secret in $${secretEnvName}`);
          process.exitCode = 1;
          return;
        }
        let built: ReturnType<typeof buildPolicy>;
        try {
          built = buildPolicy(opts);
        } catch (err) {
          deps.stdout(err instanceof Error ? err.message : String(err));
          process.exitCode = 1;
          return;
        }
        let factory = opts.factory;
        let token = opts.token;
        if (!factory || !token) {
          try {
            const d = deploymentFor(opts.network);
            factory ??= d.factory;
            token ??= d.usdc;
          } catch (err) {
            deps.stdout(err instanceof Error ? err.message : String(err));
            process.exitCode = 1;
            return;
          }
        }
        const rpcUrl = getRpcUrl(opts.network, opts.rpc ? { url: opts.rpc } : undefined);
        const networkPassphrase = getNetworkPassphrase(opts.network);
        const server = new Server(rpcUrl);
        let saltIndex: number;
        if (opts.salt !== undefined) {
          saltIndex = Number(opts.salt);
          if (!Number.isInteger(saltIndex) || saltIndex < 0) {
            deps.stdout("salt: must be a non-negative integer");
            process.exitCode = 1;
            return;
          }
        } else {
          saltIndex = await deps.nextCardIndex(owner.publicKey(), { rpc: server, factory, passphrase: networkPassphrase });
        }
        const result = await deps.createCard(
          { owner, signer: built.signer, token, label: built.label, policy: built.policy, saltIndex, factory, networkPassphrase },
          { rpc: server },
        );
        if (opts.json) {
          deps.stdout(toJson({ ...result, network: opts.network, factory, token, policy: built.policy, label: built.label }));
          return;
        }
        deps.stdout(`Card: ${result.card}`);
        deps.stdout(`Label: ${built.label}`);
        deps.stdout(`Owner: ${result.owner}`);
        deps.stdout(`Salt index: ${result.saltIndex}`);
        deps.stdout(`Network: ${opts.network}`);
        deps.stdout(`Tx: ${result.txHash}`);
        deps.stdout(`Next: send USDC to the card address, then open ${DEFAULT_APP_URL}/cards with the owner's wallet — the card is discovered there without importing it.`);
      },
    );

  return program;
}

// Re-exported so callers building `--json` output against `status` can type the result.
export type { CardInfo };

/**
 * Resolves a path through symlinks, falling back to a plain `path.resolve`
 * when the path does not exist (e.g. under test) or cannot be read.
 */
function realOrResolved(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

// Robust equivalent of `import.meta.url === \`file://${process.argv[1]}\``:
// resolves both sides through symlinks before comparing, so it works when the
// CLI is invoked through its installed bin symlink (npm links `mooring` into
// `node_modules/.bin`, which points at the package under `node_modules/@mooring-live/cli`,
// itself a workspace symlink — `fileURLToPath(import.meta.url)` follows all of
// that back to the real `dist/index.js`, but `process.argv[1]` does not unless
// resolved the same way). Never runs `parseAsync` when the module is only imported.
const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realOrResolved(process.argv[1]);

if (isMainModule) {
  void buildProgram()
    .parseAsync(process.argv)
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
