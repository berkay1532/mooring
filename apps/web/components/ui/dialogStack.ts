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

/** What a dialog's Tab cycle can land on. Disabled controls are filtered with `:disabled` below. */
const FOCUSABLE_SELECTOR =
  'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** Marks the global toast stack (`TxToastProvider`), which stays reachable from an open dialog. */
export const TOAST_REGION_SELECTOR = "[data-toast-region]";

/**
 * The open dialog's Tab cycle: the panel's own focusable controls, then the
 * toast stack's (a write started in the dialog reports there). `:disabled`
 * also catches controls disabled only through a `<fieldset disabled>`, which
 * carry no `disabled` attribute of their own.
 */
export function dialogFocusables(panel: HTMLElement | null): HTMLElement[] {
  const inPanel = Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
  const inToasts = Array.from(
    document.querySelectorAll<HTMLElement>(`${TOAST_REGION_SELECTOR} :is(${FOCUSABLE_SELECTOR})`),
  );
  return [...inPanel, ...inToasts].filter((el) => !el.matches(":disabled"));
}

/**
 * Keeps Tab inside the front-most dialog (plus the toast stack). The cycle
 * is driven by hand rather than left to the browser, so focus that has
 * already fallen out — e.g. to `<body>` when the clicked primary button
 * became disabled while its write is in flight — is pulled back in instead
 * of walking the page behind an `aria-modal` dialog.
 */
export function trapTab(event: KeyboardEvent, panel: HTMLElement | null, token: DialogToken): void {
  if (!isTopDialog(token)) return;
  event.preventDefault();
  const items = dialogFocusables(panel);
  if (items.length === 0) {
    panel?.focus();
    return;
  }
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    index === -1
      ? event.shiftKey
        ? items.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
  items[next].focus();
}
