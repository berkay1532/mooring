"use client";

import { StrKey } from "@stellar/stellar-sdk";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { SMALL_BUTTON_CLASS, SURFACE_CLASS } from "@/components/cards/PolicySection";
import { MerchantConfirmModal, type ConfirmTarget } from "@/components/merchants/MerchantConfirmModal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { config, isDev } from "@/lib/config";
import { shortAddress } from "@/lib/format/address";
import { resolveMerchantUrl } from "@/lib/merchants/client";
import { describeTerms, networkLabel } from "@/lib/merchants/describe";
import { formatMerchantPrice } from "@/lib/merchants/price";
import type { ResolveErr, ResolveOk } from "@/lib/merchants/resolve";
import { seedServices } from "@/lib/merchants/seed";

/** A service the owner has looked up and may approve. */
export interface ResolvedMerchant {
  payTo: string;
  url: string;
  host: string;
  name: string;
  description?: string;
  amount: string;
  network: string;
}

export interface MerchantResolverProps {
  initialUrl?: string;
  /** Start a lookup on mount when `initialUrl` is set. */
  autoResolve?: boolean;
  /** `payTo` values already allowed (or already in the draft). */
  existing: readonly string[];
  onConfirm: (m: ResolvedMerchant) => void | Promise<void>;
  /** When provided, the "Add by address instead" disclosure is shown. */
  onAddByAddress?: (address: string) => void | Promise<void>;
  confirmLabel: (host: string) => string;
  confirming?: boolean;
  disabled?: boolean;
  /** `sign` (default): approving starts a transaction; `list`: only adds to a draft list. */
  confirmMode?: "sign" | "list";
  /** The request arrived through a link; adds a caution sentence. */
  linkOrigin?: boolean;
  /** Injectable for tests. */
  resolve?: typeof resolveMerchantUrl;
}

type State =
  | { kind: "idle" }
  | { kind: "resolving" }
  | { kind: "ok"; result: ResolveOk }
  | { kind: "error"; result: ResolveErr };

const NAME_MAX = 64;
const CAPTION_CLASS = "font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo";

function toMerchant(r: ResolveOk): ResolvedMerchant {
  const host = new URL(r.url).host;
  return {
    payTo: r.payTo,
    url: r.url,
    host,
    name: (r.service?.name ?? host).slice(0, NAME_MAX),
    description: r.service?.description,
    amount: r.amount,
    network: r.network,
  };
}

/**
 * The one approval UI for adding a paid service: look up a URL, review what the
 * service asks for, and let the owner decide. Mooring only checks that the
 * service is payable by this card; it never vouches for it.
 */
export function MerchantResolver({
  initialUrl,
  autoResolve,
  existing,
  onConfirm,
  onAddByAddress,
  confirmLabel,
  confirming,
  disabled,
  linkOrigin,
  confirmMode = "sign",
  resolve = resolveMerchantUrl,
}: MerchantResolverProps) {
  const inputId = useId();
  const [url, setUrl] = useState(initialUrl ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [addrOpen, setAddrOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [pendingAddr, setPendingAddr] = useState<ConfirmTarget | null>(null);
  const seq = useRef(0);
  const autoStarted = useRef(false);

  const lookUp = useCallback(
    async (target: string) => {
      const trimmed = target.trim();
      if (!trimmed) return;
      const mine = ++seq.current;
      setState({ kind: "resolving" });
      const result = await resolve(trimmed);
      if (mine !== seq.current) return;
      setState(result.ok ? { kind: "ok", result } : { kind: "error", result });
    },
    [resolve],
  );

  // Runs on mount and whenever `initialUrl` changes; the ref guards against
  // StrictMode's double invocation by remembering the last URL it handled.
  const handledUrl = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (handledUrl.current === initialUrl) return;
    const first = handledUrl.current === undefined && !autoStarted.current;
    handledUrl.current = initialUrl;
    autoStarted.current = true;
    if (!first) {
      seq.current++;
      setUrl(initialUrl ?? "");
      setState({ kind: "idle" });
    }
    if (autoResolve && initialUrl) void lookUp(initialUrl);
  }, [autoResolve, initialUrl, lookUp]);

  useEffect(() => {
    if (state.kind === "error") document.getElementById(inputId)?.focus();
  }, [state.kind, inputId]);

  const resolving = state.kind === "resolving";
  // The local example seller only makes sense where the resolver may reach
  // loopback: the mock-wallet e2e build and `next dev`.
  const seeds = state.kind === "idle" ? seedServices(config.network, config.walletMode === "mock" || isDev) : [];
  const addressOk =
    (StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address)) &&
    !existing.includes(address);

  return (
    <div className={SURFACE_CLASS}>
      <Field
        id={inputId}
        label="Service URL"
        placeholder="https://api.example.com/weather"
        value={url}
        disabled={resolving || disabled}
        invalid={state.kind === "error"}
        onChange={(e) => {
          setUrl(e.target.value);
          seq.current++;
          setState({ kind: "idle" });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void lookUp(url);
        }}
      />
      <div role="status" aria-live="polite">
        {state.kind === "error" ? (
          <>
            <p className="mt-1.5 text-xs text-danger-text">{state.result.message}</p>
            {state.result.found?.length ? (
              <ul className="mt-2 space-y-1 text-xs text-text-lo">
                {describeTerms(state.result.found, config.network, config.usdc).lines.map((line, i) => (
                  <li key={i}>This service accepts: {line}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="mt-3">
        <Button variant="ghost" className={SMALL_BUTTON_CLASS} loading={resolving} disabled={disabled || !url.trim()} onClick={() => void lookUp(url)}>
          Look up
        </Button>
      </div>

      {seeds.length ? (
        <div className="mt-4">
          <p className={CAPTION_CLASS}>Examples, not recommendations.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {seeds.map((s) => (
              <Button
                key={s.url}
                variant="ghost"
                className={SMALL_BUTTON_CLASS}
                title={s.note}
                disabled={disabled}
                onClick={() => {
                  setUrl(s.url);
                  void lookUp(s.url);
                }}
              >
                {s.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {state.kind === "ok" ? <Preview result={state.result} {...{ existing, onConfirm, confirmLabel, confirming, disabled, linkOrigin, confirmMode }} /> : null}

      {onAddByAddress ? (
        <div className="mt-4">
          <Button variant="ghost" className={SMALL_BUTTON_CLASS} aria-expanded={addrOpen} onClick={() => setAddrOpen((o) => !o)}>
            Add by address instead
          </Button>
          {addrOpen ? (
            <div className="flex items-end gap-2">
              <Field
                className="flex-1"
                label="Merchant address"
                placeholder="G… or C…"
                value={address}
                onChange={(e) => setAddress(e.target.value.trim())}
              />
              <Button
                variant="ghost"
                className={`${SMALL_BUTTON_CLASS} mb-0.5`}
                disabled={disabled || !addressOk}
                onClick={() => setPendingAddr({ payTo: address, name: shortAddress(address) })}
              >
                Add
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ConfirmFlow
        target={pendingAddr}
        mode={confirmMode}
        confirming={confirming}
        disabled={disabled}
        already={pendingAddr ? existing.includes(pendingAddr.payTo) : false}
        onClose={() => setPendingAddr(null)}
        onConfirm={async (t) => {
          await onAddByAddress?.(t.payTo);
          setAddress("");
        }}
      />
    </div>
  );
}

/**
 * Owns the confirmation modal for one target: open only while a target is set
 * (so its checkbox cannot outlive a close), closes itself if the target becomes
 * already-allowed, and keeps the modal up with a spinner until the confirm
 * settles. The in-flight ref makes a double click on the primary a no-op.
 */
function ConfirmFlow({
  target,
  mode,
  linkOrigin,
  confirming,
  disabled,
  already,
  onClose,
  onConfirm,
}: {
  target: ConfirmTarget | null;
  mode: "sign" | "list";
  linkOrigin?: boolean;
  confirming?: boolean;
  disabled?: boolean;
  already: boolean;
  onClose: () => void;
  onConfirm: (t: ConfirmTarget) => void | Promise<void>;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (target && already) onClose();
  }, [target, already, onClose]);
  if (!target) return null;
  return (
    <MerchantConfirmModal
      key={target.payTo}
      open
      merchant={target}
      mode={mode}
      linkOrigin={linkOrigin}
      confirming={confirming || busy}
      disabled={disabled || already}
      onCancel={onClose}
      onConfirm={async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        try {
          await onConfirm(target);
        } finally {
          inFlight.current = false;
          setBusy(false);
          onClose();
        }
      }}
    />
  );
}

type PreviewProps = { result: ResolveOk } & Pick<
  MerchantResolverProps,
  "existing" | "onConfirm" | "confirmLabel" | "confirming" | "disabled" | "linkOrigin" | "confirmMode"
>;

function Preview({ result, existing, onConfirm, confirmLabel, confirming, disabled, linkOrigin, confirmMode = "sign" }: PreviewProps) {
  const m = toMerchant(result);
  const already = existing.includes(m.payTo);
  const [pending, setPending] = useState<ResolvedMerchant | null>(null);
  const closePending = useCallback(() => setPending(null), []);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  function copy() {
    const p = navigator.clipboard?.writeText(m.payTo);
    p?.then(() => {
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }
  return (
    <div role="group" aria-label={`Service ${m.name}`} className="mt-4 rounded-[10px] border border-text-hi/[0.12] p-3.5">
      <p className="text-sm font-bold text-text-hi">{m.name}</p>
      {m.description ? <p className="mt-1 text-xs text-text-lo">{m.description.slice(0, 280)}</p> : null}
      <p className="mt-2 font-mono text-sm text-text-hi">{formatMerchantPrice(m.amount)} USDC / request</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-text-lo">
        <span>{networkLabel(m.network)}</span>
        <span className="font-mono" title={m.payTo}>
          {shortAddress(m.payTo)}
        </span>
        <Button variant="ghost" className={SMALL_BUTTON_CLASS} aria-label="Copy address" onClick={copy}>
          Copy
        </Button>
        <span role="status">{copied ? "Copied" : ""}</span>
      </div>
      {linkOrigin ? (
        <p className="mt-3 text-xs text-text-hi">
          This request came from a link. Make sure it is a service your agent is meant to use.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-text-lo">
        Mooring only checked that this service accepts payments from this card&apos;s network and token. It does not vouch for the service. Allowing it lets your agent pay it up to the card&apos;s limits — whether to trust it is your decision.
      </p>
      <div className="mt-3">
        {already ? (
          <Button disabled>Already allowed</Button>
        ) : (
          <Button loading={confirming} disabled={disabled} onClick={() => setPending(m)}>
            {confirmLabel(m.host)}
          </Button>
        )}
      </div>
      <ConfirmFlow
        target={pending}
        mode={confirmMode}
        linkOrigin={linkOrigin}
        confirming={confirming}
        disabled={disabled}
        already={pending ? existing.includes(pending.payTo) : false}
        onClose={closePending}
        onConfirm={(t) => onConfirm(t as ResolvedMerchant)}
      />
    </div>
  );
}
