"use client";

import { useEffect, useId, useMemo, useState } from "react";

import { SMALL_BUTTON_CLASS } from "@/components/cards/PolicySection";
import { Button } from "@/components/ui/Button";
import type { DirectoryLoader } from "@/lib/directory/client";
import { matches } from "@/lib/directory/merge";
import type { DirectoryEntry, DirectoryResponse } from "@/lib/directory/types";
import { formatMerchantPrice } from "@/lib/merchants/price";
import { networkLabel } from "@/lib/merchants/describe";

export interface BrowseServicesProps {
  load: DirectoryLoader;
  /** `payTo` values already allowed (or already in the draft). */
  existing: readonly string[];
  disabled?: boolean;
  /** The owner picked a service; the parent re-checks its live 402 before anything is allowed. */
  onPick: (entry: DirectoryEntry) => void;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: DirectoryResponse }
  | { kind: "error" };

const CAPTION_CLASS = "font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo";
const SEARCH_CLASS =
  "w-full rounded-full border border-text-hi/[0.18] bg-transparent px-3.5 py-1.5 font-body text-xs text-text-hi outline-none placeholder:text-text-lo focus-visible:ring-2 focus-visible:ring-amber";
const ROW_CLASS = "flex items-center justify-between gap-3 border-b border-text-hi/[0.06] py-2.5 text-sm last:border-b-0";
const TAG_CLASS = "inline-block rounded-full px-2 py-0.5 font-body text-[11px] leading-normal";
const EMPTY_TEXT = "No Stellar services listed yet. Paste a URL instead.";

/**
 * The merchant directory as a pickable list. Everything here is *listed, not
 * vetted*: the sources are public catalogues, and picking a row only fills the
 * URL field — the resolver re-reads the live 402 and the owner still confirms.
 */
export function BrowseServices({ load, existing, disabled, onPick }: BrowseServicesProps) {
  const searchId = useId();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [q, setQ] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    load().then(
      (data) => live && setState({ kind: "ready", data }),
      () => live && setState({ kind: "error" }),
    );
    return () => {
      live = false;
    };
  }, [load, attempt]);

  const items = useMemo(
    () => (state.kind === "ready" ? state.data.items.filter((e) => matches(e, q)) : []),
    [state, q],
  );

  return (
    <div className="mt-4" data-testid="browse-services">
      <div className="flex items-center justify-between gap-3">
        <p className={CAPTION_CLASS}>Browse services</p>
        {state.kind === "ready" && state.data.items.length ? (
          <label className="sr-only" htmlFor={searchId}>
            Search services
          </label>
        ) : null}
      </div>
      {state.kind === "ready" && state.data.items.length ? (
        <input
          id={searchId}
          type="search"
          className={`${SEARCH_CLASS} mt-2`}
          placeholder="⌕ search by name, host or tag"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={disabled}
        />
      ) : null}

      <div role="status" aria-live="polite">
        {state.kind === "loading" ? <p className="mt-2 text-xs text-text-lo">Loading the directory…</p> : null}
        {state.kind === "error" ? (
          <p className="mt-2 text-xs text-text-lo">
            The directory is unavailable right now. {EMPTY_TEXT.split(". ")[1]}{" "}
            <Button variant="ghost" className={SMALL_BUTTON_CLASS} onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          </p>
        ) : null}
        {state.kind === "ready" && state.data.items.length === 0 ? <p className="mt-2 text-xs text-text-lo">{EMPTY_TEXT}</p> : null}
        {state.kind === "ready" && state.data.items.length > 0 && items.length === 0 ? (
          <p className="mt-2 text-xs text-text-lo">Nothing matches “{q}”.</p>
        ) : null}
      </div>

      {items.length ? (
        <ul aria-label="Services" className="mt-1 max-h-72 overflow-y-auto pr-1">
          {items.map((e) => {
            const allowed = existing.includes(e.payTo);
            return (
              <li key={e.id} className={ROW_CLASS}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-text-hi">
                    {e.name}
                    {e.kind === "mcp" ? <span className={`${TAG_CLASS} ml-2 bg-text-lo/15 text-text-lo`}>MCP</span> : null}
                    {e.proxy ? (
                      <span className={`${TAG_CLASS} ml-2 bg-amber/15 text-amber`} title="One address fronts many services; allowing it allows all of them">
                        proxy
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-text-lo">
                    <span className="font-mono">{e.host}</span>
                    {" · "}
                    <span className="font-mono text-text-hi">{formatMerchantPrice(e.amount)} USDC</span>
                    {" / request"}
                    {e.verified ? " · verified by source" : ""}
                    {e.settlements ? ` · ${e.settlements} payments` : ""}
                  </p>
                  {e.description ? <p className="mt-0.5 line-clamp-2 text-xs text-text-lo">{e.description}</p> : null}
                </div>
                {allowed ? (
                  <span className="shrink-0 text-xs text-text-lo">Allowed</span>
                ) : (
                  <Button variant="ghost" className={`${SMALL_BUTTON_CLASS} shrink-0`} disabled={disabled} aria-label={`Add ${e.name}`} onClick={() => onPick(e)}>
                    Add
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {state.kind === "ready" && state.data.other.count > 0 ? (
        <details className="mt-3 text-xs text-text-lo">
          <summary className="cursor-pointer select-none">
            On {networkLabel(state.data.other.network)} · {state.data.other.count} services (not payable from this card)
          </summary>
          <ul aria-label={`Services on ${networkLabel(state.data.other.network)}`} className="mt-1 max-h-48 overflow-y-auto pr-1">
            {state.data.other.items.map((e) => (
              <li key={e.id} className={ROW_CLASS}>
                <div className="min-w-0">
                  <p className="truncate text-sm text-text-hi">{e.name}</p>
                  <p className="truncate text-xs text-text-lo">
                    <span className="font-mono">{e.host}</span> · {formatMerchantPrice(e.amount)} USDC / request
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {state.data.other.proxyCount ? (
            <p className="mt-2">
              Plus {state.data.other.proxyCount} services behind a router address (one <span className="text-amber">proxy</span> payee).
            </p>
          ) : null}
        </details>
      ) : null}

      {state.kind === "ready" ? (
        <p className={`${CAPTION_CLASS} mt-3`}>Listed, not vetted. Examples, not recommendations.</p>
      ) : null}
    </div>
  );
}
