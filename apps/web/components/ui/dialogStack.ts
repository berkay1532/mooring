/**
 * A tiny module-level stack of open dialogs (`Sheet`/`Modal`), so that when
 * one is stacked on another (e.g. a typed Cancel confirmation `Modal` over
 * the card details `Sheet`), only the top-most dialog's Escape handler
 * closes it — the one underneath stays open (review finding: minor 8).
 *
 * Each dialog instance calls `pushDialog(panel)` once per "became open" cycle
 * and `popDialog(token)` in its cleanup; `isTopDialog(token)` tells its
 * keydown handler whether it is still the front-most dialog before acting on
 * Escape.
 *
 * Push order alone is not enough. React runs child effects before parent
 * effects, so a `Modal open` rendered *inside* a `Sheet open` in one commit
 * registers first and the sheet would end up "on top" (Task 6 review,
 * residual 1). The front-most dialog is therefore resolved at keydown time:
 * the last-pushed entry, unless its panel element contains another open
 * dialog's panel — a nested dialog is always in front of the one it is
 * rendered inside, whichever order the effects ran in.
 */
export type DialogToken = symbol;

interface DialogEntry {
  token: DialogToken;
  /** The dialog's panel element, when the caller has one (always, in the DOM). */
  panel: HTMLElement | null;
}

let stack: DialogEntry[] = [];

export function pushDialog(panel?: HTMLElement | null): DialogToken {
  const token: DialogToken = Symbol("dialog");
  stack = [...stack, { token, panel: panel ?? null }];
  return token;
}

export function popDialog(token: DialogToken): void {
  stack = stack.filter((entry) => entry.token !== token);
}

/** The front-most open dialog: last pushed, then walked down into any dialog nested inside it. */
function topEntry(): DialogEntry | undefined {
  let top = stack[stack.length - 1];
  if (!top) return undefined;
  // At most one step per entry: each pass can only move *into* a dialog
  // nested in the current candidate, so the loop cannot cycle.
  for (let step = 0; step < stack.length; step++) {
    const nested = stack.find(
      (entry) => entry !== top && top.panel && entry.panel && top.panel.contains(entry.panel),
    );
    if (!nested) break;
    top = nested;
  }
  return top;
}

export function isTopDialog(token: DialogToken): boolean {
  return topEntry()?.token === token;
}
