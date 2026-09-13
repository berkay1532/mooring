"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { config } from "@/lib/config";
import { WalletBadge } from "@/components/layout/WalletBadge";

const LINK_CLASS =
  "rounded font-mono text-xs uppercase tracking-[0.1em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber";

/** The app's top bar: wordmark, navigation, and the wallet badge (mockup's `.topbar`). */
export function HeaderBar() {
  const pathname = usePathname();
  const onCards = pathname?.startsWith("/cards") ?? false;

  return (
    // `flex-wrap`: below ~420px the wordmark, the two nav links and the wallet
    // badge no longer fit on one line, and without it the badge pushed the
    // document ~60px wider than the viewport (caught by the 400px e2e smoke).
    // It has no effect at any width where the row already fits.
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-text-hi/[0.07] bg-bg-raised/60 px-6 py-4 sm:px-8">
      <div className="flex items-center gap-6">
        <span className="font-display text-lg tracking-[0.06em] text-text-hi">MOORING</span>
        <nav className="flex items-center gap-5">
          <Link
            href="/cards"
            aria-current={onCards ? "page" : undefined}
            className={`${LINK_CLASS} ${
              onCards ? "border-b-2 border-amber pb-1 text-text-hi" : "text-text-lo hover:text-text-hi"
            }`}
          >
            My cards
          </Link>
          <a
            href={config.docsUrl}
            target="_blank"
            rel="noreferrer"
            className={`${LINK_CLASS} text-text-lo hover:text-text-hi`}
          >
            Docs
          </a>
        </nav>
      </div>
      <WalletBadge />
    </header>
  );
}
