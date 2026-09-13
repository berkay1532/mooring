import { config } from "@/lib/config";
import { WalletBadge } from "@/components/layout/WalletBadge";

/** The app's top bar: wordmark + docs link on the left, the wallet badge on the right. */
export function HeaderBar() {
  return (
    <header className="flex items-center justify-between border-b border-text-hi/[0.07] bg-bg-raised/60 px-6 py-4 sm:px-8">
      <div className="flex items-center gap-6">
        <span className="font-display text-lg tracking-[0.06em] text-text-hi">MOORING</span>
        <a
          href={config.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs uppercase tracking-[0.1em] text-text-lo transition hover:text-text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber rounded"
        >
          Docs
        </a>
      </div>
      <WalletBadge />
    </header>
  );
}
