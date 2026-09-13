/**
 * A tiny module-level stack of open dialogs (`Sheet`/`Modal`), so that when
 * one is stacked on another (e.g. a typed Cancel confirmation `Modal` over
 * the card details `Sheet`), only the top-most dialog's Escape handler
 * closes it — the one underneath stays open (review finding: minor 8).
 *
 * Each dialog instance calls `pushDialog()` once per "became open" cycle and
 * `popDialog(token)` in its cleanup; `isTopDialog(token)` tells its keydown
 * handler whether it is still the front-most dialog before acting on Escape.
 */
export type DialogToken = symbol;

let stack: DialogToken[] = [];

export function pushDialog(): DialogToken {
  const token: DialogToken = Symbol("dialog");
  stack = [...stack, token];
  return token;
}

export function popDialog(token: DialogToken): void {
  stack = stack.filter((t) => t !== token);
}

export function isTopDialog(token: DialogToken): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token;
}
