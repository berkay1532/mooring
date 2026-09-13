"use client";

import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { useWallet, type WalletContextValue } from "@/lib/wallet/context";
import { networkLabel } from "@/lib/wallet/types";

const FREIGHTER_INSTALL_URL = "https://www.freighter.app/";

const AMBER_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2 focus-visible:ring-offset-bg-deep";

type GateProps = Pick<WalletContextValue, "status" | "ready" | "connect">;

/**
 * The Connect screen's states (spec §3.1): not-installed, installed-but-not-
 * connected, and the blocking wrong-network notice. Shared by `app/page.tsx`
 * (the `/` route itself) and {@link NetworkGuard} (every other route), so
 * both present the same screen when the wallet isn't ready.
 *
 * While `!ready` (the adapter hasn't answered `isAvailable()` yet) this
 * renders only the wordmark — no button, no install link, no paragraph.
 * Showing a live "Connect Freighter" button before the first check resolves
 * would let a user without Freighter click into a call that never settles
 * (Freighter's `isAllowed()` has no timeout), and would flash the button in
 * front of a returning, already-allowed user for the instant before the
 * redirect to `/cards`.
 */
export function GateContent({ status, ready, connect }: GateProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="font-display text-4xl tracking-[0.04em] text-text-hi sm:text-5xl">MOORING</h1>

      {!ready ? null : status === "wrong-network" ? (
        <p
          role="status"
          aria-live="polite"
          className="max-w-md rounded-full border border-danger/40 bg-danger/10 px-5 py-2 font-mono text-sm text-danger"
        >
          Wrong network — switch your wallet to {networkLabel(config.networkPassphrase)}.
        </p>
      ) : (
        <>
          <p className="max-w-md text-balance text-sm leading-relaxed text-text-lo sm:text-base">
            Mooring gives an AI agent a spending card that pays for services on its own — inside a
            hard on-chain budget, merchant allowlist, and expiry you set. Your funds stay in your
            wallet&apos;s control the whole time.
          </p>

          {status === "unavailable" ? (
            <a
              href={FREIGHTER_INSTALL_URL}
              target="_blank"
              rel="noreferrer"
              className={`rounded-full bg-amber px-6 py-2.5 font-mono text-sm font-medium text-bg-deep transition hover:brightness-110 ${AMBER_FOCUS_RING}`}
            >
              Install Freighter
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              className={`rounded-full bg-amber px-6 py-2.5 font-mono text-sm font-medium text-bg-deep transition hover:brightness-110 ${AMBER_FOCUS_RING}`}
            >
              Connect Freighter
            </button>
          )}
        </>
      )}
    </main>
  );
}

/** Renders `children` only once the wallet is connected to the right network. */
export function NetworkGuard({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  if (wallet.status !== "connected") {
    return <GateContent status={wallet.status} ready={wallet.ready} connect={wallet.connect} />;
  }
  return <>{children}</>;
}
