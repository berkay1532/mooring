"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { GateContent } from "@/components/layout/NetworkGuard";
import { useWallet } from "@/lib/wallet/context";

/** The Connect screen (spec §3.1): the app's `/` route. */
export default function ConnectPage() {
  const router = useRouter();
  const wallet = useWallet();

  useEffect(() => {
    if (wallet.status === "connected") {
      router.replace("/cards");
    }
  }, [wallet.status, router]);

  if (wallet.status === "connected") return null;

  return <GateContent status={wallet.status} connect={wallet.connect} />;
}
