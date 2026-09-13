"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { HeaderBar } from "@/components/layout/HeaderBar";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { Toast } from "@/components/ui/Toast";
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
  const [toast, setToast] = useState<string | null>(null);

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
      setToast("Card created");
      router.push("/cards?fund=1");
    },
    [owner, queryClient, router],
  );

  const flow = useCreateCard(createDraft, onFinished);

  const stepValid = step === 0 ? !label.error && policy.policy !== undefined : step === 1 ? agent.valid : true;

  function go(next: number) {
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

  return (
    <main className="px-6 pb-16 pt-7 sm:px-8">
      <div className="mx-auto max-w-[1100px]">
        <h1 className="font-display text-[28px] leading-tight text-text-hi">New card</h1>
        <p className="mt-0.5 text-[13px] text-text-lo">
          A spending card for one agent: a budget it cannot exceed, a list of who it may pay, and a date it
          stops.
        </p>

        <Steps className="mt-5" current={step} maxReached={maxStep} onGo={go} />

        <div className="mt-6 flex flex-col gap-7 lg:flex-row">
          <PreviewCard
            label={draft.label}
            budgetBase={policy.budgetBase}
            expiryUnix={policy.expiryUnix}
            merchantCount={draft.merchants.length}
            signer={agent.valid ? draft.agentKey.trim() : undefined}
            address={address}
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

            {step === 2 && policy.policy ? (
              <ConfirmStep
                label={draft.label.trim()}
                policy={policy.policy}
                agentKey={draft.agentKey.trim()}
                merchants={draft.merchants}
                address={address}
                addressError={Boolean(saltQuery.error)}
                progress={
                  flow.phase === "merchants" && merchantsLeft > 0
                    ? `Card created. Adding merchant ${flow.merchantIndex + 1} of ${draft.merchants.length}.`
                    : undefined
                }
                tx={{ state: flow.state, hash: flow.hash ?? undefined, error: flow.error ?? undefined }}
                canCreate={createDraft !== null && !flow.busy}
                creating={flow.busy}
                onBack={() => go(1)}
                onCreate={flow.phase === "merchants" ? flow.retryMerchant : flow.start}
                submitLabel={flow.phase === "merchants" ? "Retry this merchant" : undefined}
                onSkipMerchants={flow.phase === "merchants" ? flow.skipMerchants : undefined}
              />
            ) : null}
          </div>
        </div>
      </div>

      {toast ? <Toast message={toast} tone="success" onDismiss={() => setToast(null)} /> : null}
    </main>
  );
}
