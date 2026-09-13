"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { config } from "../config";
import type { Wallet } from "../chain/card";
import { freighterAdapter } from "./freighter";
import { mockAdapter } from "./mock";
import { toWallet, type WalletAdapter } from "./types";

export type WalletStatus = "unavailable" | "disconnected" | "wrong-network" | "connected";

export interface WalletContextValue {
  status: WalletStatus;
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

  const refresh = useCallback(async () => {
    const isAvailable = await resolvedAdapter.isAvailable();
    setAvailable(isAvailable);
    if (!isAvailable) {
      setAddress(null);
      setNetworkPassphrase(null);
      return;
    }
    const [addr, passphrase] = await Promise.all([
      resolvedAdapter.getAddress(),
      resolvedAdapter.getNetworkPassphrase(),
    ]);
    setAddress(addr);
    setNetworkPassphrase(passphrase);
  }, [resolvedAdapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!resolvedAdapter.onChange) return;
    return resolvedAdapter.onChange((s) => {
      setAddress(s.address);
      setNetworkPassphrase(s.networkPassphrase);
    });
  }, [resolvedAdapter]);

  const connect = useCallback(async () => {
    const { address: addr } = await resolvedAdapter.connect();
    const passphrase = await resolvedAdapter.getNetworkPassphrase();
    setAvailable(true);
    setAddress(addr);
    setNetworkPassphrase(passphrase);
  }, [resolvedAdapter]);

  const disconnect = useCallback(async () => {
    await resolvedAdapter.disconnect();
    setAddress(null);
    setNetworkPassphrase(null);
  }, [resolvedAdapter]);

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
    () => ({ status, address, networkPassphrase, connect, disconnect, adapter: resolvedAdapter, wallet }),
    [status, address, networkPassphrase, connect, disconnect, resolvedAdapter, wallet],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
