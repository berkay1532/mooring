"use client";

import { useId, useMemo, useState } from "react";

import { MooringCard } from "@/components/card/MooringCard";
import { faceState, type CardFaceState, type CardSummary } from "@/components/cards/summary";
import { Pill } from "@/components/ui/Pill";
import { shortAddress } from "@/lib/format/address";
import { formatCountdown } from "@/lib/format/time";
import { formatUsdc } from "@/lib/format/usdc";

export interface CardListProps {
  items: readonly CardSummary[];
  selected: string | null;
  onSelect: (address: string) => void;
  nowUnix?: number;
}

const STATUS_OPTIONS: Array<{ value: "all" | CardFaceState; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "frozen", label: "Frozen" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

const TH_CLASS =
  "border-b border-text-hi/[0.08] px-3 py-2 text-left font-mono text-[10px] font-normal uppercase tracking-[0.16em] text-text-lo";
const TD_CLASS = "border-b border-text-hi/[0.05] px-3 py-3 align-middle text-text-hi";
const CONTROL_CLASS =
  "rounded-full border border-text-hi/[0.18] bg-transparent px-3.5 py-1.5 font-body text-xs text-text-hi outline-none placeholder:text-text-lo focus-visible:ring-2 focus-visible:ring-amber";

/**
 * The list view (mockup's table, design spec §3.2): thumbnail, label, short
 * address, status pill, balance, the period bar, per-tx cap, expiry and an
 * "Open ›" that selects the row — plus a search box (label or address) and a
 * status filter. It is also the accessible alternative to the carousel.
 */
export function CardList({ items, selected, onSelect, nowUnix }: CardListProps) {
  const now = nowUnix ?? Math.floor(Date.now() / 1000);
  const searchId = useId();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CardFaceState>("all");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !`${item.info?.label ?? ""} ${item.address}`.toLowerCase().includes(q)) return false;
      if (status !== "all") {
        if (!item.info) return false;
        if (faceState(item.info, now) !== status) return false;
      }
      return true;
    });
  }, [items, query, status, now]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <label htmlFor={searchId} className="sr-only">
          Search cards
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="⌕ search"
          onChange={(event) => setQuery(event.target.value)}
          className={CONTROL_CLASS}
        />
        <label htmlFor={statusId} className="sr-only">
          Status filter
        </label>
        <select
          id={statusId}
          value={status}
          onChange={(event) => setStatus(event.target.value as "all" | CardFaceState)}
          className={CONTROL_CLASS}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value} className="bg-surface">
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse font-body text-sm">
          <thead>
            <tr>
              <th className={TH_CLASS}>Card</th>
              <th className={TH_CLASS}>Status</th>
              <th className={TH_CLASS}>Balance</th>
              <th className={TH_CLASS}>This period</th>
              <th className={TH_CLASS}>Per tx</th>
              <th className={TH_CLASS}>Expires</th>
              <th className={TH_CLASS}>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const info = item.info;
              const state = info ? faceState(info, now) : "active";
              const spentPct =
                info && info.policy.period_amount > 0n
                  ? Math.min(100, Number((info.period.spent * 10_000n) / info.policy.period_amount) / 100)
                  : 0;
              const isSelected = item.address === selected;
              return (
                <tr
                  key={item.address}
                  data-selected={isSelected ? "true" : "false"}
                  className={isSelected ? "bg-amber/[0.06]" : ""}
                >
                  <td className={TD_CLASS}>
                    <span className="mr-2.5 inline-block align-middle">
                      <MooringCard size="thumb" state={state} label={info?.label ?? item.address} />
                    </span>
                    {info?.label ?? "…"}
                    <span className="ml-1.5 font-mono text-xs text-text-lo">{shortAddress(item.address)}</span>
                  </td>
                  <td className={TD_CLASS}>
                    <Pill tone={state}>{state}</Pill>
                  </td>
                  <td className={TD_CLASS} title={info ? `${formatUsdc(info.balance, { full: true })} USDC` : undefined}>
                    {info ? formatUsdc(info.balance) : "—"}
                  </td>
                  <td className={TD_CLASS}>
                    <span className="mr-2 inline-block h-[5px] w-[110px] overflow-hidden rounded-full bg-text-hi/[0.08] align-middle">
                      <span className="block h-full rounded-full bg-seaglass" style={{ width: `${spentPct}%` }} />
                    </span>
                    <span className="font-mono text-xs">
                      {info ? `${formatUsdc(info.period.spent)} / ${formatUsdc(info.policy.period_amount)}` : "—"}
                    </span>
                  </td>
                  <td className={TD_CLASS}>{info ? formatUsdc(info.policy.max_per_tx) : "—"}</td>
                  <td className={TD_CLASS}>{info ? formatCountdown(Number(info.policy.expiry), now) : "—"}</td>
                  <td className={TD_CLASS}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.address)}
                      className="rounded font-body text-amber transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
                    >
                      <span aria-hidden>Open ›</span>
                      <span className="sr-only">Open {info?.label ?? item.address}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center font-body text-sm text-text-lo">No cards match this search.</p>
        ) : null}
      </div>
    </div>
  );
}
