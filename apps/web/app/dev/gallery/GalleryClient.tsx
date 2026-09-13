"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { Stat } from "@/components/ui/Stat";
import { Toast } from "@/components/ui/Toast";
import { Toggle } from "@/components/ui/Toggle";
import { TxStatus, type TxState } from "@/components/ui/TxStatus";
import { MooringCard, type MooringCardSize, type MooringCardState } from "@/components/card/MooringCard";

const BASE = 10_000_000n;
const NOW = Math.floor(Date.now() / 1000);

const CARD_SIZES: MooringCardSize[] = ["carousel", "preview", "thumb"];
const CARD_STATES: MooringCardState[] = ["active", "frozen", "expired", "cancelled", "draft"];
const PILL_TONES: PillTone[] = ["active", "frozen", "expired", "cancelled"];
const TX_STATES: TxState[] = ["idle", "preparing", "signing", "submitted", "confirmed", "failed"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-text-hi/[0.07] pt-8">
      <h2 className="font-display text-2xl text-text-hi">{title}</h2>
      <div className="mt-5 flex flex-wrap items-start gap-6">{children}</div>
    </section>
  );
}

/**
 * The interactive body of `/dev/gallery` — every design-system primitive,
 * `MooringCard` in every size/state, and `TxStatus` in every state, with
 * mock data. Not wrapped in `NetworkGuard`: this route never talks to a
 * wallet or the chain.
 */
export function GalleryClient() {
  const [toggleValue, setToggleValue] = useState<"hour" | "day" | "week" | "custom">("day");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-10 sm:px-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-amber">Dev only</p>
        <h1 className="mt-2 font-display text-4xl text-text-hi">Design-system gallery</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-lo">
          Every primitive, the card face in each size and state, and the transaction-status timeline in each
          state — for visual review against the approved mockups.
        </p>
      </header>

      <Section title="Button">
        <Button variant="primary">Fund card</Button>
        <Button variant="ghost">Freeze</Button>
        <Button variant="danger">Cancel card</Button>
        <Button variant="primary" loading>
          Signing…
        </Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
      </Section>

      <Section title="Field">
        <Field label="Card name" placeholder="inference-agent" className="w-64" />
        <Field label="Period budget" defaultValue="50" unit="USDC / day" hint="Resets each period, no carry-over." className="w-64" />
        <Field label="Per-tx cap" defaultValue="120" unit="USDC" error="Cannot exceed the period budget (code #11)." className="w-64" />
      </Section>

      <Section title="Pill">
        {PILL_TONES.map((tone) => (
          <Pill key={tone} tone={tone}>
            {tone}
          </Pill>
        ))}
      </Section>

      <Section title="Stat">
        <Stat label="balance" value="11.00" />
        <Stat label="remaining today" value="40.00" />
        <Stat label="per tx" value="10.00" />
        <Stat label="expires" value="29d" />
      </Section>

      <Section title="Toggle">
        <Toggle
          aria-label="Period unit"
          value={toggleValue}
          onChange={setToggleValue}
          options={[
            { value: "hour", label: "hour" },
            { value: "day", label: "day" },
            { value: "week", label: "week" },
            { value: "custom", label: "custom" },
          ]}
        />
      </Section>

      <Section title="Sheet / Modal / Toast">
        <Button variant="ghost" onClick={() => setSheetOpen(true)}>
          Open Sheet
        </Button>
        <Button variant="ghost" onClick={() => setModalOpen(true)}>
          Open Modal
        </Button>
        <Button variant="ghost" onClick={() => setToastOpen(true)}>
          Show Toast
        </Button>

        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Fund card">
          <p className="mt-2 text-sm text-text-lo">inference-agent · balance 11.00 USDC</p>
          <Field label="Amount" defaultValue="20" unit="USDC · in wallet 184.20" className="mt-4" />
          <div className="mt-6 flex justify-end gap-2.5">
            <Button variant="ghost" onClick={() => setSheetOpen(false)}>
              Close
            </Button>
            <Button variant="primary">Send with Freighter</Button>
          </div>
        </Sheet>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Cancel card">
          <p className="mt-2 text-sm text-text-lo">
            Permanent — sweeps the full balance to your wallet and stops all future payments.
          </p>
          <div className="mt-6 flex justify-end gap-2.5">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Back
            </Button>
            <Button variant="danger">Cancel card</Button>
          </div>
        </Modal>

        {toastOpen ? <Toast message="Card frozen." tone="success" onDismiss={() => setToastOpen(false)} /> : null}
      </Section>

      <Section title="MooringCard — sizes">
        {CARD_SIZES.map((size) => (
          <MooringCard
            key={size}
            size={size}
            state="active"
            label="inference-agent"
            address="CAJPWJRJPFIY6XYYQIVCC3XLYFYQVNJIJ6XVPTUY4EBLNQ3CFN2AHCJ"
            signer="GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7"
            balance={11n * BASE}
            spent={40n * BASE}
            periodAmount={50n * BASE}
            expiry={NOW + 29 * 86_400}
            allowCount={1}
            nowUnix={NOW}
          />
        ))}
      </Section>

      <Section title="MooringCard — states (carousel, unselected)">
        {CARD_STATES.map((state) => (
          <MooringCard
            key={state}
            size="carousel"
            state={state}
            label={`${state}-agent`}
            address="CB7QF5V3WQ6RM2KAZC4Y4BXVYNXQKQ3ZC4Y4BXVYNXQKQ3ZC4Y4M2KA"
            signer="GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7"
            balance={state === "draft" ? undefined : 2n * BASE + 4n * (BASE / 10n)}
            spent={5n * BASE}
            periodAmount={5n * BASE}
            expiry={state === "expired" || state === "cancelled" || state === "draft" ? undefined : NOW + 12 * 86_400}
            allowCount={3}
            nowUnix={NOW}
          />
        ))}
      </Section>

      <Section title="MooringCard — selected ring">
        <MooringCard
          size="carousel"
          state="active"
          selected
          label="ops-agent"
          address="CDX19QWE4Y4BXVYNXQKQ3ZC4Y4BXVYNXQKQ3ZC4Y4BXVYNXQKQ3Y9QWE"
          signer="GDHDJL3RT6S3OABSHLOEOCBH4BMMAKLVOR5FPEHXG5ZW2DDJDRRJJSM7"
          balance={120n * BASE}
          spent={37n * BASE}
          periodAmount={100n * BASE}
          expiry={NOW + 88 * 86_400}
          allowCount={32}
          nowUnix={NOW}
        />
      </Section>

      <Section title="TxStatus — states">
        <div className="w-full max-w-md space-y-6">
          {TX_STATES.map((state) => (
            <div key={state}>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-lo">{state}</p>
              {state === "confirmed" ? (
                <TxStatus
                  state={state}
                  hash="a1b2c3d4"
                  explorerUrl="https://stellar.expert/explorer/testnet/tx/a1b2c3d4"
                />
              ) : state === "failed" ? (
                <TxStatus
                  state={state}
                  error={{
                    title: "Policy rejected",
                    detail: "Per-tx limit cannot exceed the period budget (code #11).",
                    next: "Fix the policy",
                  }}
                  onNext={() => {}}
                />
              ) : (
                <TxStatus state={state} />
              )}
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
