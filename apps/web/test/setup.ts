import "@testing-library/jest-dom/vitest";

// Recent Node versions (used here) ship their own experimental global
// `localStorage`, which is inert without a `--localstorage-file` path (no
// `setItem`/`getItem`/`clear`). vitest's jsdom environment sees that global
// already exists and — reasonably, for any *ordinary* Node global — skips
// installing its own accessor over it, leaving the inert stub in place
// instead of jsdom's real, per-test `Storage`. Re-point the global at
// jsdom's own `localStorage` (exposed on the environment as `jsdom.window`)
// so `lib/prefs.ts` and its tests get working, isolated storage.
declare const jsdom: { window: { localStorage: Storage } } | undefined;
if (typeof jsdom !== "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => jsdom.window.localStorage,
  });
}
