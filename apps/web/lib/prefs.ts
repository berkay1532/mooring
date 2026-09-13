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

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
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

/**
 * Records `address` as `owner`'s selected card, or clears the stored
 * selection when `address` is `null` — the cards screen clears it when the
 * selected card is removed from the dashboard, so the next visit does not
 * restore a card that is no longer listed.
 */
export function setSelected(owner: string, address: string | null): void {
  const key = ownerKey(owner, "selected");
  if (address === null) {
    removeKey(key);
    return;
  }
  writeString(key, address);
}

/**
 * The dashboard's card list view mode, keyed by owner like every other
 * preference here: one browser profile switching between owner accounts
 * should not carry a twelve-card owner's list view into a one-card owner's
 * dashboard.
 *
 * `fallback` is what to use when this owner has never chosen one — the cards
 * screen passes `"list"` once there are ten or more cards, so a large
 * dashboard opens in the view that can actually show it, while anyone who
 * has picked a view keeps theirs. Defaults to `"grid"`.
 */
export function getViewMode(owner: string, fallback: ViewMode = DEFAULT_VIEW_MODE): ViewMode {
  const raw = readString(ownerKey(owner, "view"));
  return raw === "grid" || raw === "list" ? raw : fallback;
}

/** Sets `owner`'s card list view mode. */
export function setViewMode(owner: string, mode: ViewMode): void {
  writeString(ownerKey(owner, "view"), mode);
}
