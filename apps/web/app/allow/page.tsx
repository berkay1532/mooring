"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { HeaderBar } from "@/components/layout/HeaderBar";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { AllowScreen } from "@/components/merchants/AllowScreen";

export default function AllowPage() {
  return (
    <NetworkGuard>
      <HeaderBar />
      <Suspense fallback={null}>
        <AllowRoute />
      </Suspense>
    </NetworkGuard>
  );
}

/** Reads the link's `card` and `url` parameters (needs the Suspense above). */
function AllowRoute() {
  const params = useSearchParams();
  return <AllowScreen card={params.get("card")} url={params.get("url")} />;
}
