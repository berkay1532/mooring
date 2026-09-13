/**
 * Per-owner UI preferences, persisted in `localStorage`. Every read and
 * write is wrapped in try/catch: a private-browsing quota, disabled storage,
 * or a non-browser (SSR) environment must never throw through to a caller —
 * reads fall back to their default and writes silently no-op.
 *
 * Keys are namespaced by owner (`mooring:<owner>:<thing>`) so one browser
 * profile switching between owner accounts never sees another owner's
 * added-card list or selection.
 */

export type ViewMode = "grid" | "list";

const DEFAULT_VIEW_MODE: ViewMode = "grid";
const VIEW_MODE_KEY = "mooring:view-mode";

function ownerKey(owner: string, suffix: string): string {
  return `mooring:${owner}:${suffix}`;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota, SSR, disabled) — no-op.
  }
}

function readString(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — no-op.
  }
}

/** The cards this owner has added to their dashboard. Defaults to `[]`. */
export function getAddedCards(owner: string): string[] {
  const list = readJSON<unknown>(ownerKey(owner, "added"), []);
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
}

/** Adds `address` to `owner`'s added-card list. Idempotent. */
export function addCard(owner: string, address: string): void {
  const current = getAddedCards(owner);
  if (current.includes(address)) return;
  writeJSON(ownerKey(owner, "added"), [...current, address]);
}

/** Removes `address` from `owner`'s added-card list. No-op if absent. */
export function removeCard(owner: string, address: string): void {
  writeJSON(
    ownerKey(owner, "added"),
    getAddedCards(owner).filter((a) => a !== address),
  );
}

/** The card `owner` last selected in the dashboard, if any. */
export function getSelected(owner: string): string | undefined {
  return readString(ownerKey(owner, "selected"));
}

/** Records `address` as `owner`'s selected card. */
export function setSelected(owner: string, address: string): void {
  writeString(ownerKey(owner, "selected"), address);
}

/**
 * The dashboard's card list view mode.
 *
 * `fallback` is what to use when the owner has never chosen one — the cards
 * screen passes `"list"` once there are ten or more cards, so a large
 * dashboard opens in the view that can actually show it, while anyone who
 * has picked a view keeps theirs. Defaults to `"grid"`.
 */
export function getViewMode(fallback: ViewMode = DEFAULT_VIEW_MODE): ViewMode {
  const raw = readString(VIEW_MODE_KEY);
  return raw === "grid" || raw === "list" ? raw : fallback;
}

/** Sets the dashboard's card list view mode. */
export function setViewMode(mode: ViewMode): void {
  writeString(VIEW_MODE_KEY, mode);
}
