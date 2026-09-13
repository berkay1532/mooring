"use client";

import { useState } from "react";

import { shortAddress } from "@/lib/format/address";
import { useWallet } from "@/lib/wallet/context";
import { networkLabel } from "@/lib/wallet/types";

const AMBER_FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber rounded-full";

/** The connected wallet's short address, network pill, and disconnect — the header bar's right side. */
export function WalletBadge() {
  const { address, networkPassphrase, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);

  if (!address) return null;

  const network = networkPassphrase ? networkLabel(networkPassphrase) : null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address as string);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be unavailable (permissions, older browsers) —
      // the address is still visible on the badge, so this is a soft failure.
    }
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-text-hi/[0.14] px-3 py-1.5">
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-seaglass" />
      <button
        type="button"
        onClick={() => void handleCopy()}
        className={`font-mono text-xs text-text-hi ${AMBER_FOCUS_RING}`}
        aria-label={copied ? "Address copied" : `Copy wallet address ${address}`}
      >
        {copied ? "Copied" : shortAddress(address)}
      </button>
      {network ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-lo">{network}</span>
      ) : null}
      <button
        type="button"
        onClick={() => void disconnect()}
        className={`font-mono text-[11px] text-text-lo transition hover:text-text-hi ${AMBER_FOCUS_RING}`}
      >
        Disconnect
      </button>
    </div>
  );
}
