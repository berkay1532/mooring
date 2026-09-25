"use client";

import type { ReactNode } from "react";

import { TxToastProvider } from "@/components/ui/TxToast";
import { QueryProvider } from "@/lib/query/client";
import { WalletProvider } from "@/lib/wallet/context";

/**
 * Composes the app's client-side providers: React Query, the wallet, then
 * the global toast stack (transaction progress and notices), which sits
 * above the routes so a toast survives navigation.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <WalletProvider>
        <TxToastProvider>{children}</TxToastProvider>
      </WalletProvider>
    </QueryProvider>
  );
}
