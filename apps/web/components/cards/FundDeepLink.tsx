"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export interface FundDeepLinkProps {
  /** Called once when the current URL carries `?fund=1`. */
  onFund: () => void;
}

/**
 * `/cards?fund=1` — the link the new-card wizard lands on, which opens the
 * Fund sheet for the freshly created card (spec §3.3). Renders nothing.
 *
 * It is its own component because `useSearchParams()` opts the whole
 * component that calls it into client-side rendering, and Next 15 requires
 * such a component to sit under a `<Suspense>` boundary; keeping it to this
 * leaf means the cards screen itself is unaffected. The parameter is
 * stripped straight afterwards (`router.replace`), so a reload — or a
 * "close the sheet, come back later" — doesn't re-open the sheet.
 */
export function FundDeepLink({ onFund }: FundDeepLinkProps) {
  const params = useSearchParams();
  const router = useRouter();

  // The callback is usually an inline closure; keeping it in a ref means a
  // re-render of the cards screen can never re-fire the deep link.
  const callback = useRef(onFund);
  callback.current = onFund;
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || params?.get("fund") !== "1") return;
    fired.current = true;
    callback.current();
    router.replace("/cards");
  }, [params, router]);

  return null;
}
