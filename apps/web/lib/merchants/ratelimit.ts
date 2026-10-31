/**
 * Fixed-window, in-memory rate limiter. State is per server instance, which is
 * enough to blunt abuse of the resolver without extra infrastructure.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): {
  take(key: string): boolean
} {
  const now = opts.now ?? Date.now
  const windows = new Map<string, { start: number; count: number }>()
  return {
    take(key) {
      const t = now()
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (t - w.start >= opts.windowMs) windows.delete(k)
      }
      const w = windows.get(key)
      if (!w || t - w.start >= opts.windowMs) {
        windows.set(key, { start: t, count: 1 })
        return true
      }
      if (w.count >= opts.limit) return false
      w.count += 1
      return true
    },
  }
}
