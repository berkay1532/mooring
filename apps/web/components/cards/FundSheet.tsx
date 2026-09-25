"use client";

import { useEffect, useState } from "react";

import { opButtonLabel, useCardOp, type OpModalProps } from "@/components/cards/busy";
import { exactAmount } from "@/components/cards/summary";
import { TRUSTLINE_MISSING_COPY, trustlineStatus } from "@/components/cards/trustline";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Toggle } from "@/components/ui/Toggle";
import { buildFundTransfer } from "@/lib/chain/card";
import { formatUsdc, parseUsdc } from "@/lib/format/usdc";
import { useUsdcBalance } from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";

type FundTab = "wallet" | "address";

/** The one `qrcode` entry point this component uses. */
type QrcodeModule = { toString(text: string, options?: Record<string, unknown>): Promise<string> };

const TABS = [
  { value: "wallet", label: "From my wallet" },
  { value: "address", label: "Show address" },
] as const;

export interface FundSheetProps extends OpModalProps {
  owner: string;
}

/**
 * The funding panel (mockup's `.sheet`): send USDC from the connected wallet
 * to the card, or show the card's address and QR so it can be funded from
 * anywhere else. The transfer is a plain SAC `transfer(owner → card)` signed
 * by the owner — the card's own policy is not involved in funding it.
 */
export function FundSheet({ open, onClose, address, info, owner }: FundSheetProps) {
  const [tab, setTab] = useState<FundTab>("wallet");
  const [amount, setAmount] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setTab("wallet");
      setAmount("");
    }
  }, [open]);

  const walletBalance = useUsdcBalance(owner, { enabled: open });
  const trustline = trustlineStatus(walletBalance.error, walletBalance.data !== undefined, walletBalance.isLoading);
  const available = walletBalance.data;

  useEffect(() => {
    if (!open || tab !== "address") return;
    let cancelled = false;
    void (async () => {
      try {
        // `qrcode` is CommonJS: depending on the bundler's interop the
        // namespace object either *is* the module or carries it on `default`.
        const mod = (await import("qrcode")) as unknown as QrcodeModule & { default?: QrcodeModule };
        const qrcode = mod.default ?? mod;
        const svg = await qrcode.toString(address, {
          type: "svg",
          margin: 1,
          color: { dark: "#f2eee4", light: "#0a152200" },
        });
        if (!cancelled) setQr(svg);
      } catch {
        if (!cancelled) setQr(null); // the address below is still copyable
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tab, address]);

  const parsed = parseUsdc(amount.trim());
  const tooMuch = parsed !== null && available !== undefined && parsed > available;
  const error =
    amount.trim() === ""
      ? undefined
      : parsed === null
        ? "Enter an amount like 12.50 (up to 7 decimals)."
        : parsed <= 0n
          ? "Enter an amount greater than 0."
          : tooMuch
            ? `Your wallet holds ${formatUsdc(available as bigint, { full: true })} USDC.`
            : undefined;

  const op = useCardOp<bigint>("fund", (value) => buildFundTransfer(owner, address, value), {
    invalidates: () => [keys.info(address), keys.balance(owner)],
    label: (value) => `Fund ${info.label} with ${formatUsdc(value)} USDC`,
    onDone: onClose,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the address is on screen and selectable.
    }
  }

  const quickPicks = ["10", "50", "100"];

  return (
    <Sheet open={open} onClose={onClose} title="Fund the card">
      <p className="mt-1 text-xs text-text-lo">
        {info.label} · balance{" "}
        <span title={`${formatUsdc(info.balance, { full: true })} USDC`}>{formatUsdc(info.balance)} USDC</span>
      </p>

      <fieldset disabled={op.mine} className="min-w-0">
        <Toggle
          className="mt-3.5"
          shape="segment"
          aria-label="Funding method"
          options={TABS}
          value={tab}
          onChange={(value) => setTab(value as FundTab)}
        />
      </fieldset>

      {tab === "wallet" ? (
        <>
          <fieldset disabled={op.mine} className="min-w-0">
            <Field
              label="Amount"
              value={amount}
              inputMode="decimal"
              unit={available !== undefined ? `USDC · ${formatUsdc(available)} in wallet` : "USDC"}
              onChange={(event) => setAmount(event.target.value)}
              error={error}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {quickPicks.map((pick) => (
                <Button key={pick} variant="ghost" className="px-2.5 py-1 text-[11px]" onClick={() => setAmount(pick)}>
                  {pick}
                </Button>
              ))}
              <Button
                variant="ghost"
                className="px-2.5 py-1 text-[11px]"
                disabled={available === undefined}
                title={available !== undefined ? `${formatUsdc(available, { full: true })} USDC` : undefined}
                onClick={() => available !== undefined && setAmount(exactAmount(available))}
              >
                Max
              </Button>
            </div>

            {trustline === "missing" ? (
              <p className="mt-3 rounded-[14px] border border-amber/30 bg-bg-raised px-4 py-3 text-xs text-text-lo">
                {TRUSTLINE_MISSING_COPY}
              </p>
            ) : null}
          </fieldset>

          <div className="mt-5 flex justify-end gap-2.5">
            <Button variant="ghost" onClick={onClose} disabled={op.mine}>
              Close
            </Button>
            <Button
              onClick={() => void op.run(parsed as bigint)}
              loading={op.mine}
              // A wallet with no USDC trustline holds no USDC at all, so the
              // transfer is certain to fail at simulation — don't spend a
              // signature on it.
              disabled={parsed === null || parsed <= 0n || tooMuch || op.locked || trustline === "missing"}
            >
              {opButtonLabel(op.state, "Send with my wallet")}
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <div className="flex items-start gap-3">
            {/* The markup here is always SVG generated by `qrcode` from the
                card's own C… address above — never user-supplied input.
                Keep it that way: nothing else may reach this attribute. */}
            <div
              aria-hidden
              className="h-24 w-24 shrink-0 rounded-lg bg-bg-raised p-1 [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={qr ? { __html: qr } : undefined}
            />
            <p className="text-xs text-text-lo">
              Send USDC to this address from any wallet or exchange. It is the card&apos;s own Soroban account — only
              you can move funds back out.
            </p>
          </div>
          <p className="mt-3 break-all font-mono text-xs text-text-hi">{address}</p>
          <div className="mt-4 flex justify-end gap-2.5">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button onClick={() => void copy()}>{copied ? "Copied" : "Copy address"}</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
