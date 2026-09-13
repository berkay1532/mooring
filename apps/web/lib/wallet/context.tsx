"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { config } from "../config";
import type { Wallet } from "../chain/card";
import { freighterAdapter } from "./freighter";
import { toWallet, type WalletAdapter } from "./types";

export type WalletStatus = "unavailable" | "disconnected" | "wrong-network" | "connected";

export interface WalletContextValue {
  status: WalletStatus;
  /**
   * `false` until the adapter has answered `isAvailable()` at least once
   * (including a rejected attempt). `status` reads as `"disconnected"` the
   * whole time (so the four statuses stay exactly what the brief specifies),
   * but a consumer must not render a live "Connect"/"Install" affordance
   * before `ready` — there is nothing to react to yet, and for a user
   * without Freighter a click in that window can call into a Freighter
   * method that never resolves.
   */
  ready: boolean;
  address: string | null;
  networkPassphrase: string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  adapter: WalletAdapter;
  /** `null` until connected; then a `card.ts`-compatible signer for the tx builders. */
  wallet: Wallet | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * A stand-in for the brief moment a `mock` build is still loading its
 * adapter chunk. Never reachable in a shipping (`freighter`) build, where
 * `freighterAdapter` is the synchronous default.
 */
const PENDING_ADAPTER: WalletAdapter = {
  id: "freighter",
  async isAvailable() {
    return false;
  },
  async connect() {
    throw new Error("The wallet adapter is still loading");
  },
  async disconnect() {},
  async getAddress() {
    return null;
  },
  async getNetworkPassphrase() {
    return null;
  },
  async signTransaction(xdr) {
    return xdr;
  },
};

/**
 * The mock wallet is behind a dynamic import guarded by the *literal*
 * `process.env.NEXT_PUBLIC_WALLET` read that Next inlines at build time: in a
 * `freighter` build the condition is statically false, so webpack drops the
 * branch and `lib/wallet/mock.ts` never reaches a production chunk (verified
 * in CI by grepping the built chunks for `__mooringMock`). A misconfigured
 * deploy therefore cannot serve a fake wallet that "connects" to a fixed
 * address unless the build itself was made with `NEXT_PUBLIC_WALLET=mock`.
 */
async function loadDefaultAdapter(): Promise<WalletAdapter> {
  if (process.env.NEXT_PUBLIC_WALLET === "mock") {
    const { mockAdapter } = await import("./mock");
    return mockAdapter;
  }
  return freighterAdapter;
}

export function WalletProvider({
  children,
  adapter,
}: {
  children: ReactNode;
  /** Overrides the config-selected adapter — used by tests to inject a fake. */
  adapter?: WalletAdapter;
}) {
  // `freighter` (the shipping configuration) resolves synchronously; only a
  // `mock` build waits a tick for its dynamically imported adapter.
  const [loadedAdapter, setLoadedAdapter] = useState<WalletAdapter | null>(() =>
    config.walletMode === "mock" ? null : freighterAdapter,
  );
  const resolvedAdapter = useMemo(() => adapter ?? loadedAdapter, [adapter, loadedAdapter]);

  useEffect(() => {
    if (adapter || loadedAdapter) return;
    let cancelled = false;
    void loadDefaultAdapter().then((loaded) => {
      if (!cancelled) setLoadedAdapter(() => loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, loadedAdapter]);

  // `available` starts `null` (unknown, still checking) rather than a
  // boolean so the initial render never claims "unavailable" before the
  // adapter has actually answered.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // The `onChange` subscription is managed imperatively (not by a
  // dependent effect) so it can be started/stopped in step with actual
  // connection state: only once the adapter is known available, and
  // explicitly around connect()/disconnect() so a session-only
  // disconnect() doesn't get silently undone by the next watcher tick.
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const stopWatching = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
  }, []);

  const startWatching = useCallback(() => {
    if (unsubscribeRef.current || !resolvedAdapter?.onChange) return;
    unsubscribeRef.current = resolvedAdapter.onChange((s) => {
      setAddress(s.address);
      setNetworkPassphrase(s.networkPassphrase);
      // A watcher tick that carries an address proves the wallet is present
      // and reachable, even if an earlier `isAvailable()` transiently read
      // `false` (e.g. the extension's content-script injection race on a
      // hard reload) — don't leave the app stuck on "Install Freighter".
      if (s.address) setAvailable(true);
    });
  }, [resolvedAdapter]);

  // False once the provider has unmounted (or the adapter changed), so a
  // `refresh()` that is still awaiting its first `isAvailable()` cannot start
  // a watcher — or write state — after the cleanup has already run.
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!resolvedAdapter) return;
    try {
      const isAvailable = await resolvedAdapter.isAvailable();
      if (!activeRef.current) return;
      setAvailable(isAvailable);
      if (!isAvailable) {
        setAddress(null);
        setNetworkPassphrase(null);
        stopWatching();
        return;
      }
      startWatching();
      const [addr, passphrase] = await Promise.all([
        resolvedAdapter.getAddress(),
        resolvedAdapter.getNetworkPassphrase(),
      ]);
      if (!activeRef.current) return;
      setAddress(addr);
      setNetworkPassphrase(passphrase);
    } catch {
      // A rejected call (e.g. `getNetworkDetails()` surfacing a Freighter
      // error) leaves `available`/`address` at their last known values
      // rather than throwing through render — `ready` still flips in
      // `finally` below so the gate stops showing its loading state.
    } finally {
      if (activeRef.current) setReady(true);
    }
  }, [resolvedAdapter, startWatching, stopWatching]);

  useEffect(() => {
    activeRef.current = true;
    void refresh();
    return () => {
      activeRef.current = false;
      stopWatching();
    };
    // `stopWatching` is stable (empty deps); only `refresh` identity matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const connect = useCallback(async () => {
    if (!resolvedAdapter) throw new Error("The wallet adapter is still loading");
    const { address: addr } = await resolvedAdapter.connect();
    const passphrase = await resolvedAdapter.getNetworkPassphrase();
    setAvailable(true);
    setAddress(addr);
    setNetworkPassphrase(passphrase);
    setReady(true);
    startWatching();
  }, [resolvedAdapter, startWatching]);

  const disconnect = useCallback(async () => {
    stopWatching();
    if (!resolvedAdapter) return;
    await resolvedAdapter.disconnect();
    setAddress(null);
    setNetworkPassphrase(null);
  }, [resolvedAdapter, stopWatching]);

  const status: WalletStatus = useMemo(() => {
    if (available === false) return "unavailable";
    if (!address) return "disconnected";
    if (networkPassphrase !== config.networkPassphrase) return "wrong-network";
    return "connected";
  }, [available, address, networkPassphrase]);

  const wallet = useMemo(
    () => (address && resolvedAdapter ? toWallet(resolvedAdapter, address) : null),
    [resolvedAdapter, address],
  );

  const value: WalletContextValue = useMemo(
    () => ({
      status,
      ready,
      address,
      networkPassphrase,
      connect,
      disconnect,
      adapter: resolvedAdapter ?? PENDING_ADAPTER,
      wallet,
    }),
    [status, ready, address, networkPassphrase, connect, disconnect, resolvedAdapter, wallet],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
