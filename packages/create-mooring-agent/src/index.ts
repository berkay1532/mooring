#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextSteps, packageName, scaffold } from "./scaffold.js";

const DEFAULT_SERVICE = "https://api.mooring.live/quote";
const DEFAULT_NETWORK = "stellar:testnet";
const NETWORKS = ["stellar:testnet", "stellar:pubnet"];

const USAGE = `Usage: create-mooring-agent <dir> [--service <url>] [--network <network>]

  --service <url>      the paid URL the agent requests (default ${DEFAULT_SERVICE})
  --network <network>  ${NETWORKS.join(" or ")} (default ${DEFAULT_NETWORK})`;

interface Args {
  dir?: string;
  service: string;
  network: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { service: DEFAULT_SERVICE, network: DEFAULT_NETWORK, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    const flag = /^--(service|network)(?:=(.*))?$/.exec(arg);
    if (flag) {
      const value = flag[2] ?? argv[++i];
      if (value === undefined || value === "") throw new Error(`--${flag[1]} needs a value`);
      args[flag[1] as "service" | "network"] = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    if (args.dir !== undefined) throw new Error(`unexpected argument ${arg}`);
    args.dir = arg;
  }
  return args;
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.dir) {
    console.error(USAGE);
    return 1;
  }
  if (!NETWORKS.includes(args.network)) {
    console.error(`--network must be ${NETWORKS.join(" or ")} (got ${args.network})`);
    return 1;
  }
  try {
    const url = new URL(args.service);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
  } catch {
    console.error(`--service must be an http(s) URL (got ${args.service})`);
    return 1;
  }

  const dir = path.resolve(args.dir);
  const name = packageName(dir);
  const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "template");
  try {
    await scaffold({ dir, name, service: args.service, network: args.network, templateDir });
  } catch (err) {
    console.error(`${dir}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const rel = path.relative(process.cwd(), dir) || ".";
  console.log(`Created ${name} in ${dir}`);
  console.log(`It pays ${args.service} on ${args.network} from a Mooring card.`);
  console.log("");
  console.log(`Next steps (in ${rel}):`);
  for (const line of nextSteps(readFileSync(path.join(dir, "README.md"), "utf8"))) console.log(line);
  return 0;
}

process.exitCode = await main();
