"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * The React Query provider for the app. Per §4.1 of the design spec, card
 * reads (`info`/`merchants`) poll every 10 s while a tab is visible and are
 * invalidated immediately after a write — `refetchOnWindowFocus` is off
 * because the interval already covers staleness and a focus refetch would
 * just add a redundant RPC call.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
