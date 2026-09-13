import type { WalletAdapter } from "./types";

/** The fixed address the mock adapter "connects" to. */
export const MOCK_ADDRESS = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";

const MOCK_PASSPHRASE = "Test SDF Network ; September 2015";
const WRONG_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export type MooringMockMode = "unavailable" | "wrong-network" | undefined;

declare global {
  interface Window {
    /**
     * A hook for Playwright (and this file's own unit tests) to force the
     * mock adapter into a state that isn't reachable by normal use — set
     * `window.__mooringMock = { mode: "unavailable" }` or
     * `{ mode: "wrong-network" }` from the test before the page loads.
     * Leaving it unset (or `mode` undefined) is the normal path.
     */
    __mooringMock?: { mode?: MooringMockMode };
  }
}

function mode(): MooringMockMode {
  if (typeof window === "undefined") return undefined;
  return window.__mooringMock?.mode;
}

let connectedAddress: string | null = null;

type Listener = (s: { address: string | null; networkPassphrase: string | null }) => void;
const listeners = new Set<Listener>();

function currentState(): { address: string | null; networkPassphrase: string | null } {
  return {
    address: connectedAddress,
    networkPassphrase: connectedAddress ? (mode() === "wrong-network" ? WRONG_PASSPHRASE : MOCK_PASSPHRASE) : null,
  };
}

function emit() {
  const state = currentState();
  for (const cb of listeners) cb(state);
}

/**
 * Fixed-address wallet used when `NEXT_PUBLIC_WALLET=mock` (local dev and
 * tests without the Freighter extension). `connect()`/`disconnect()` track a
 * single in-memory "connected" flag; `signTransaction` returns the input XDR
 * unchanged so a caller can stub submission around it.
 */
export const mockAdapter: WalletAdapter = {
  id: "mock",

  async isAvailable() {
    return mode() !== "unavailable";
  },

  async connect() {
    if (mode() === "unavailable") throw new Error("Freighter is not installed");
    connectedAddress = MOCK_ADDRESS;
    emit();
    return { address: MOCK_ADDRESS };
  },

  async disconnect() {
    connectedAddress = null;
    emit();
  },

  async getAddress() {
    if (mode() === "unavailable") return null;
    return connectedAddress;
  },

  async getNetworkPassphrase() {
    if (!connectedAddress) return null;
    return mode() === "wrong-network" ? WRONG_PASSPHRASE : MOCK_PASSPHRASE;
  },

  async signTransaction(xdr) {
    return xdr;
  },

  onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

/** Test-only: resets the mock adapter's in-memory connection state. */
export function __resetMockAdapter(): void {
  connectedAddress = null;
  listeners.clear();
}
