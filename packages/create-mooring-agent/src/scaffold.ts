import { promises as fs } from "node:fs";
import path from "node:path";

export interface ScaffoldOptions {
  /** Where the project is written; created when missing, refused when not empty. */
  dir: string;
  /** The project's npm name (`__NAME__`). */
  name: string;
  /** The paid URL the agent requests (`__SERVICE__`). */
  service: string;
  /** The CAIP-2 Stellar network (`__NETWORK__`). */
  network: string;
  /** The template to copy. */
  templateDir: string;
}

/** The template files whose `__NAME__` / `__SERVICE__` / `__NETWORK__` placeholders are filled in. */
const SUBSTITUTED = new Set(["package.json", ".env.example", "README.md"]);

/**
 * Template files stored under another name, because `npm publish` leaves a
 * `.gitignore` out of the package. They are written under their real name.
 */
const RENAMED: Record<string, string> = { gitignore: ".gitignore" };

/** Lists `root`'s files, depth first, as `/`-separated paths relative to it. */
async function listFiles(root: string, sub = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, sub), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, rel)));
    else if (entry.isFile()) files.push(rel);
  }
  return files;
}

/** The written name of a template file (`gitignore` → `.gitignore`). */
function targetName(rel: string): string {
  const base = path.posix.basename(rel);
  const renamed = RENAMED[base];
  if (!renamed) return rel;
  const dir = path.posix.dirname(rel);
  return dir === "." ? renamed : `${dir}/${renamed}`;
}

/**
 * Copies the template into `dir`, filling in the placeholders, and returns the
 * written files as `/`-separated paths relative to `dir`.
 *
 * @throws `Error("directory is not empty")` when `dir` exists and has entries;
 *   nothing is written then.
 */
export async function scaffold(opts: ScaffoldOptions): Promise<string[]> {
  const entries = await fs.readdir(opts.dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  if (entries.length > 0) throw new Error("directory is not empty");

  const values: Record<string, string> = {
    __NAME__: opts.name,
    __SERVICE__: opts.service,
    __NETWORK__: opts.network,
  };
  const fill = (text: string) => text.replace(/__(NAME|SERVICE|NETWORK)__/g, (m) => values[m]!);

  const written: string[] = [];
  for (const rel of await listFiles(opts.templateDir)) {
    const to = targetName(rel);
    const dest = path.join(opts.dir, ...to.split("/"));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const source = path.join(opts.templateDir, ...rel.split("/"));
    if (SUBSTITUTED.has(to)) await fs.writeFile(dest, fill(await fs.readFile(source, "utf8")));
    else await fs.copyFile(source, dest);
    written.push(to);
  }
  return written;
}

/** The numbered lines of the README's `## Next steps` section, as written. */
export function nextSteps(readme: string): string[] {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => /^##\s+Next steps\s*$/.test(l));
  if (start < 0) return [];
  const steps: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (line.trim()) steps.push(line.trimEnd());
  }
  return steps;
}

/** An npm package name derived from a directory name (`My Agent` → `my-agent`). */
export function packageName(dir: string): string {
  const base = path.basename(path.resolve(dir));
  const name = base
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, "-")
    .replace(/^[._-]+|-+$/g, "");
  return name || "mooring-agent";
}
