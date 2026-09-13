"use client";

import type { ReactNode } from "react";

import { QueryProvider } from "@/lib/query/client";
import { WalletProvider } from "@/lib/wallet/context";

/** Composes the app's client-side providers: React Query, then the wallet. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <WalletProvider>{children}</WalletProvider>
    </QueryProvider>
  );
}
