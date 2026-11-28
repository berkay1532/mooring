/**
 * Per agent key, the tail of the agent-paid payments in flight. An
 * unsponsored MPP charge uses the agent account as the transaction source;
 * its sequence number is consumed only when the seller broadcasts, so a
 * second payment may only read the sequence once the first payment's seller
 * has answered.
 */
const agentLocks = new Map<string, Promise<void>>();

/** Runs `fn` once every earlier `fn` for `key` has settled; released on success and throw. */
export async function withAgentLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = agentLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  const tail = previous.then(() => done);
  agentLocks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (agentLocks.get(key) === tail) agentLocks.delete(key);
  }
}
