import { notFound } from "next/navigation";

import { GalleryClient } from "./GalleryClient";

/**
 * Dev-only visual gallery of every design-system primitive, `MooringCard`
 * (all sizes × states), and `TxToast` (all states) with mock data — so a
 * reviewer or the owner can eyeball fidelity against the mockups without
 * wiring up a wallet or a card. Deliberately outside `NetworkGuard`.
 *
 * 404s in production unless `NEXT_PUBLIC_WALLET=mock` (the same flag the
 * mock wallet adapter uses), so it never ships live on a real deployment.
 *
 * `notFound()` only works from a Server Component, so the guard lives here
 * in a plain server `page.tsx`; all the interactive gallery content (Sheet,
 * Modal, Toggle, Toast state) is delegated to the client component below.
 */
export default function GalleryPage() {
  const isProduction = process.env.NODE_ENV === "production";
  const mockWalletEnabled = process.env.NEXT_PUBLIC_WALLET === "mock";
  if (isProduction && !mockWalletEnabled) {
    notFound();
  }

  return <GalleryClient />;
}
