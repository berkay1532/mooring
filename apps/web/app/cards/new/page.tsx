"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { HeaderBar } from "@/components/layout/HeaderBar";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { Button } from "@/components/ui/Button";
import { AgentStep } from "@/components/wizard/AgentStep";
import { ConfirmStep } from "@/components/wizard/ConfirmStep";
import { PolicyStep } from "@/components/wizard/PolicyStep";
import { PreviewCard } from "@/components/wizard/PreviewCard";
import { Steps } from "@/components/wizard/Steps";
import { deriveCardAddress, saltBytes } from "@/lib/chain/derive";
import { discoverCards } from "@/lib/chain/discover";
import { getRpcServer } from "@/lib/chain/rpc";
import { config } from "@/lib/config";
import { setSelected } from "@/lib/prefs";
import { keys } from "@/lib/query/keys";
import { useWallet } from "@/lib/wallet/context";
import { useCreateCard, type CreateCardDraft } from "@/lib/wizard/useCreateCard";
import {
  emptyDraft,
  policyInput,
  validateAgentKey,
  validateLabel,
  validatePolicy,
  type WizardDraft,
} from "@/lib/wizard/validate";

export default function NewCardPage() {
  return (
    <NetworkGuard>
      <HeaderBar />
      <NewCardWizard />
    </NetworkGuard>
  );
}

/**
 * The new-card wizard (spec §3.3): policy → agent & merchants → confirm,
 * with the live preview card beside it. Nothing is signed before the last
 * step, and every rule the card contract enforces is checked here first.
 */
function NewCardWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { address: owner } = useWallet();

  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);

  // Frozen for the life of the wizard: the expiry presets ("30 days") must
  // resolve to the same second on the confirm step as they showed on step 1.
  const nowUnix = useMemo(() => Math.floor(Date.now() / 1000), []);

  const patch = useCallback((changes: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...changes })), []);

  const label = validateLabel(draft.label);
  const policy = validatePolicy(policyInput(draft, nowUnix));
  const agent = validateAgentKey(draft.agentKey);

  // An error only shows once the user has typed in that field or tried to
  // move on — an untouched form is not a wrong one.
  const gate = (value: string, error?: string) => (attempted || value.trim() !== "" ? error : undefined);
  const policyErrors = {
    budget: gate(draft.budget, policy.errors.budget),
    perTx: gate(draft.perTx, policy.errors.perTx),
    period: draft.unit === "custom" ? gate(draft.customSeconds, policy.errors.period) : policy.errors.period,
    expiry: draft.expiryPreset === "date" ? gate(draft.expiryDate, policy.errors.expiry) : policy.errors.expiry,
  };

  // The next free salt: `discoverCards` stops at the first gap, so the
  // number of cards it finds *is* the first unused index (spec §4.1).
  const saltQuery = useQuery({
    queryKey: keys.nextSalt(owner ?? ""),
    enabled: owner != null,
    queryFn: async () => {
      const found = await discoverCards(owner as string, {
        rpc: getRpcServer(),
        factory: config.factory,
        passphrase: config.networkPassphrase,
      });
      return found.length;
    },
  });
  const salt = saltQuery.data;

  const address = useMemo(
    () =>
      owner != null && salt !== undefined
        ? deriveCardAddress(owner, saltBytes(salt), config.factory, config.networkPassphrase)
        : undefined,
    [owner, salt],
  );

  const createDraft: CreateCardDraft | null =
    owner && policy.policy && agent.signer && address !== undefined && salt !== undefined
      ? {
          owner,
          label: draft.label.trim(),
          policy: policy.policy,
          signer: agent.signer,
          merchants: draft.merchants,
          salt,
          address,
        }
      : null;

  const onFinished = useCallback(
    (created: string) => {
      if (!owner) return;
      // Put the new card in the dashboard's list straight away: discovery
      // will return it too, but not before this navigation lands.
      queryClient.setQueryData<string[]>(keys.cards(owner), (prev) =>
        prev && !prev.includes(created) ? [...prev, created] : prev,
      );
      setSelected(owner, created);
      // The "Card created" toast is raised by the cards screen when it
      // handles `?fund=1`: a toast set here would be unmounted by this very
      // navigation before anyone could read it.
      router.push("/cards?fund=1");
    },
    [owner, queryClient, router],
  );

  const flow = useCreateCard(createDraft, onFinished);

  const policyValid = !label.error && policy.policy !== undefined;
  const stepValid = step === 0 ? policyValid : step === 1 ? agent.valid : true;

  // Once a transaction is in flight the wizard is read-only: editing the
  // policy would show a summary that was never deployed, and editing the
  // merchant list would shift the running `add_merchant` sequence onto the
  // wrong entry.
  const locked = flow.phase !== "idle";
  const chipsEnabled = locked
    ? [false, false, false]
    : [true, maxStep >= 1 && policyValid, maxStep >= 2 && policyValid && agent.valid];

  function go(next: number) {
    if (locked) return;
    setAttempted(false);
    setStep(next);
    setMaxStep((m) => Math.max(m, next));
  }

  function advance() {
    if (!stepValid) {
      setAttempted(true);
      return;
    }
    go(step + 1);
  }

  const merchantsLeft = draft.merchants.length - flow.merchantIndex;

  // A poll timeout is not a plain failure: the transaction may still land,
  // and re-running `create_card` with the same salt would then fail on an
  // address that already exists. Send the owner to their cards instead.
  // The title is `useContractAction`'s own constant for that case.
  const timedOut = flow.phase === "card" && flow.state === "failed" && flow.error?.title === "Not confirmed yet";

  // Frozen the moment creation starts, so the salt query refetching (the
  // create invalidates `keys.cards`, a prefix of the salt key) can never
  // swap the address on screen for the *next* card's.
  const shownAddress = flow.address ?? address;

  return (
    <main className="px-6 pb-16 pt-7 sm:px-8">
      <div className="mx-auto max-w-[1100px]">
        <h1 className="font-display text-[28px] leading-tight text-text-hi">New card</h1>
        <p className="mt-0.5 text-[13px] text-text-lo">
          A spending card for one agent: a budget it cannot exceed, a list of who it may pay, and a date it
          stops.
        </p>

        <Steps className="mt-5" current={step} enabled={chipsEnabled} onGo={go} />

        <div className="mt-6 flex flex-col gap-7 lg:flex-row">
          <PreviewCard
            label={draft.label}
            budgetBase={policy.budgetBase}
            expiryUnix={policy.expiryUnix}
            merchantCount={draft.merchants.length}
            signer={agent.valid ? draft.agentKey.trim() : undefined}
            address={shownAddress}
            nowUnix={nowUnix}
          />

          <div className="min-w-0 flex-1">
            {step === 0 ? (
              <PolicyStep
                draft={draft}
                patch={patch}
                labelBytes={label.bytes}
                labelError={gate(draft.label, label.error)}
                errors={policyErrors}
                expiryUnix={policy.expiryUnix}
                onCancel={() => router.push("/cards")}
                onContinue={advance}
              />
            ) : null}

            {step === 1 ? (
              <AgentStep
                draft={draft}
                patch={patch}
                agentValid={agent.valid}
                agentError={gate(draft.agentKey, agent.error)}
                onBack={() => go(0)}
                onContinue={advance}
              />
            ) : null}

            {step === 2 && !policy.policy ? (
              <div className="rounded-[14px] border border-text-hi/[0.07] bg-surface px-5 py-6 text-sm text-text-lo">
                <p>The policy is incomplete, so there is nothing to confirm yet.</p>
                <Button variant="ghost" className="mt-3" onClick={() => go(0)}>
                  Back to step 1
                </Button>
              </div>
            ) : null}

            {step === 2 && policy.policy ? (
              <ConfirmStep
                label={draft.label.trim()}
                policy={policy.policy}
                agentKey={draft.agentKey.trim()}
                merchants={draft.merchants}
                address={shownAddress}
                addressError={Boolean(saltQuery.error)}
                onRetryAddress={saltQuery.error ? () => void saltQuery.refetch() : undefined}
                progress={
                  timedOut
                    ? "The card may still have been created. Check My cards before trying again."
                    : flow.phase === "merchants" && merchantsLeft > 0
                      ? `Card created. Adding merchant ${flow.merchantIndex + 1} of ${draft.merchants.length}.`
                      : undefined
                }
                tx={{ state: flow.state, hash: flow.hash ?? undefined, error: flow.error ?? undefined }}
                canCreate={(createDraft !== null || timedOut) && !flow.busy}
                creating={flow.busy}
                locked={locked}
                onBack={() => go(1)}
                onCreate={
                  timedOut
                    ? () => router.push("/cards")
                    : flow.phase === "merchants"
                      ? flow.retryMerchant
                      : flow.start
                }
                submitLabel={
                  timedOut ? "Check my cards" : flow.phase === "merchants" ? "Retry this merchant" : undefined
                }
                onSkipMerchants={flow.phase === "merchants" ? flow.skipMerchants : undefined}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
