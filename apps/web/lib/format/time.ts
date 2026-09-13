/**
 * Formats a duration in whole seconds as a short human-readable string.
 *
 * Picks the coarsest unit that still applies, in this order:
 *   - >= 1 day:    "N days" (singular "1 day")
 *   - >= 1 hour:   "H h M m"
 *   - >= 1 minute: "M m S s"
 *   - otherwise:   "S s"
 *
 * Negative input is clamped to zero (`"0 s"`) — a duration is never negative.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));

  const days = Math.floor(total / 86_400);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;

  const hours = Math.floor(total / 3_600);
  if (hours >= 1) {
    const minutes = Math.floor((total % 3_600) / 60);
    return `${hours} h ${minutes} m`;
  }

  const minutes = Math.floor(total / 60);
  if (minutes >= 1) {
    const rest = total % 60;
    return `${minutes} m ${rest} s`;
  }

  return `${total} s`;
}

/**
 * Formats the time remaining until `untilUnix` (a Unix timestamp in seconds),
 * relative to `nowUnix`. Clamps at zero: once the deadline has passed (or is
 * exactly now), returns `"now"` instead of a duration.
 */
export function formatCountdown(untilUnix: number, nowUnix: number): string {
  const remaining = untilUnix - nowUnix;
  if (remaining <= 0) return "now";
  return formatDuration(remaining);
}
