"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { config } from "../config";
import type { Wallet } from "../chain/card";
import { freighterAdapter } from "./freighter";
import { mockAdapter } from "./mock";
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

function defaultAdapter(): WalletAdapter {
  return config.walletMode === "mock" ? mockAdapter : freighterAdapter;
}

export function WalletProvider({
  children,
  adapter,
}: {
  children: ReactNode;
  /** Overrides the config-selected adapter — used by tests to inject a fake. */
  adapter?: WalletAdapter;
}) {
  const resolvedAdapter = useMemo(() => adapter ?? defaultAdapter(), [adapter]);

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
    if (unsubscribeRef.current || !resolvedAdapter.onChange) return;
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

  const refresh = useCallback(async () => {
    try {
      const isAvailable = await resolvedAdapter.isAvailable();
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
      setAddress(addr);
      setNetworkPassphrase(passphrase);
    } catch {
      // A rejected call (e.g. `getNetworkDetails()` surfacing a Freighter
      // error) leaves `available`/`address` at their last known values
      // rather than throwing through render — `ready` still flips in
      // `finally` below so the gate stops showing its loading state.
    } finally {
      setReady(true);
    }
  }, [resolvedAdapter, startWatching, stopWatching]);

  useEffect(() => {
    void refresh();
    return () => stopWatching();
    // `stopWatching` is stable (empty deps); only `refresh` identity matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const connect = useCallback(async () => {
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
    () => (address ? toWallet(resolvedAdapter, address) : null),
    [resolvedAdapter, address],
  );

  const value: WalletContextValue = useMemo(
    () => ({ status, ready, address, networkPassphrase, connect, disconnect, adapter: resolvedAdapter, wallet }),
    [status, ready, address, networkPassphrase, connect, disconnect, resolvedAdapter, wallet],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
