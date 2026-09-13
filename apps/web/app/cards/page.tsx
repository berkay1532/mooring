import { HeaderBar } from "@/components/layout/HeaderBar";
import { NetworkGuard } from "@/components/layout/NetworkGuard";

/**
 * Placeholder for the My cards screen (spec §3.2) — just enough to be the
 * redirect target for the Connect screen. Task 7 replaces this with the
 * card carousel/list.
 */
export default function CardsPage() {
  return (
    <NetworkGuard>
      <HeaderBar />
      <main className="px-6 py-10 sm:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-text-lo">Cards coming soon</p>
      </main>
    </NetworkGuard>
  );
}
