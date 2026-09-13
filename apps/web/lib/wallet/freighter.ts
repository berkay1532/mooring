import type { WalletAdapter } from "./types";

/** The subset of `@stellar/freighter-api` 6's named exports this adapter uses. */
interface FreighterModule {
  isConnected(): Promise<{ isConnected: boolean; error?: FreighterApiError }>;
  isAllowed(): Promise<{ isAllowed: boolean; error?: FreighterApiError }>;
  setAllowed(): Promise<{ isAllowed: boolean; error?: FreighterApiError }>;
  requestAccess(): Promise<{ address: string; error?: FreighterApiError }>;
  getAddress(): Promise<{ address: string; error?: FreighterApiError }>;
  getNetworkDetails(): Promise<{
    network: string;
    networkUrl: string;
    networkPassphrase: string;
    error?: FreighterApiError;
  }>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string; error?: FreighterApiError }>;
  WatchWalletChanges: new (timeout?: number) => {
    watch(cb: (params: WatchParams) => void): { error?: FreighterApiError };
    stop(): void;
  };
}

interface FreighterApiError {
  code: number;
  message: string;
  ext?: string[];
}

interface WatchParams {
  address: string;
  network: string;
  networkPassphrase: string;
  error?: FreighterApiError;
}

/**
 * Every `@stellar/freighter-api` call resolves — it never rejects — with an
 * optional `error` field on success. This turns that into the thrown `Error`
 * the rest of the app expects, carrying the Freighter message and preserving
 * `error.code` numerically (`translateError` keys its "declined" branch off
 * `code === -4`).
 */
function unwrap<T extends { error?: FreighterApiError }>(res: T): Omit<T, "error"> {
  if (res.error) {
    const err = new Error(res.error.message) as Error & { code: number };
    err.code = res.error.code;
    throw err;
  }
  const { error: _error, ...rest } = res;
  return rest;
}

/**
 * Freighter only exists in the browser, and its module must never be pulled
 * into a server bundle (it touches `window` at import time). Every adapter
 * method routes through this dynamic import, which resolves to `null` during
 * SSR/SSG so callers can treat "not in a browser" the same as "not
 * installed".
 */
async function loadFreighter(): Promise<FreighterModule | null> {
  if (typeof window === "undefined") return null;
  return (await import("@stellar/freighter-api")) as unknown as FreighterModule;
}

const NOT_INSTALLED = "Freighter is not installed";

export const freighterAdapter: WalletAdapter = {
  id: "freighter",

  async isAvailable() {
    const api = await loadFreighter();
    if (!api) return false;
    const { isConnected } = unwrap(await api.isConnected());
    return isConnected;
  },

  async connect() {
    const api = await loadFreighter();
    if (!api) throw new Error(NOT_INSTALLED);
    const { isAllowed } = unwrap(await api.isAllowed());
    if (!isAllowed) {
      unwrap(await api.setAllowed());
    }
    const { address } = unwrap(await api.requestAccess());
    return { address };
  },

  async disconnect() {
    // Freighter has no programmatic "revoke access" call; the app only
    // forgets the address locally (`WalletProvider` clears its state).
  },

  async getAddress() {
    const api = await loadFreighter();
    if (!api) return null;
    const { isAllowed } = unwrap(await api.isAllowed());
    if (!isAllowed) return null;
    const { address } = unwrap(await api.getAddress());
    return address || null;
  },

  async getNetworkPassphrase() {
    const api = await loadFreighter();
    if (!api) return null;
    const { networkPassphrase } = unwrap(await api.getNetworkDetails());
    return networkPassphrase;
  },

  async signTransaction(xdr, opts) {
    const api = await loadFreighter();
    if (!api) throw new Error(NOT_INSTALLED);
    const { signedTxXdr } = unwrap(await api.signTransaction(xdr, opts));
    return signedTxXdr;
  },

  onChange(cb) {
    if (typeof window === "undefined") return () => {};
    let stopped = false;
    let watcher: { stop(): void } | null = null;
    void loadFreighter().then((api) => {
      if (!api || stopped) return;
      const instance = new api.WatchWalletChanges(3000);
      instance.watch((s) => {
        cb({ address: s.address || null, networkPassphrase: s.networkPassphrase || null });
      });
      watcher = instance;
    });
    return () => {
      stopped = true;
      watcher?.stop();
    };
  },
};
