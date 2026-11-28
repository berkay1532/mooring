import { promises as fs } from "node:fs";
import path from "node:path";

/** Retry interval while another holder has the lock. */
export const LOCK_RETRY_MS = 50;
/** How long to wait for the lock before giving up. */
export const LOCK_TIMEOUT_MS = 2_000;
/** A lock whose mtime is older than this was left by a crashed holder and is replaced. */
export const LOCK_STALE_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs `fn` while holding `<stateDir>/spend.lock`, a file created with
 * `O_EXCL` so one holder at a time — across instances and processes —
 * gets it. Retries every 50 ms for up to 2 000 ms, then throws; a lock
 * older than 30 s is treated as stale and replaced. The lock is removed
 * when `fn` settles, whether it resolves or throws.
 */
export async function withLock<T>(stateDir: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(stateDir, { recursive: true });
  const lock = path.join(stateDir, "spend.lock");
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await fs.open(lock, "wx");
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    try {
      const { mtimeMs } = await fs.stat(lock);
      if (Date.now() - mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lock, { force: true });
        continue;
      }
    } catch (err) {
      // Released between our open and stat: try again at once.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (Date.now() >= deadline) {
      throw new Error(`could not acquire ${lock} within ${LOCK_TIMEOUT_MS} ms (held by another mooring process?)`);
    }
    await sleep(LOCK_RETRY_MS);
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { force: true });
  }
}
