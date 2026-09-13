"use client";

import {
  KV_CLASS,
  SECTION_HEAD_CLASS,
  SECTION_LABEL_CLASS,
  SMALL_BUTTON_CLASS,
  SURFACE_CLASS,
} from "@/components/cards/PolicySection";
import { signerStrkey } from "@/components/cards/summary";
import { Button } from "@/components/ui/Button";
import type { CardInfo } from "@/lib/chain/card";
import { shortAddress } from "@/lib/format/address";

export interface AgentSectionProps {
  info: CardInfo;
  onRotate: () => void;
  disabled?: boolean;
}

/**
 * The agent side of the card: the signer public key the contract checks
 * every payment against, and the rotate action. The app never holds the
 * agent's secret — only this public key (spec §1).
 */
export function AgentSection({ info, onRotate, disabled }: AgentSectionProps) {
  const signer = signerStrkey(info.signer);
  return (
    <div className={SURFACE_CLASS}>
      <div className={SECTION_HEAD_CLASS}>
        <span className={SECTION_LABEL_CLASS}>Agent</span>
        <Button variant="ghost" className={SMALL_BUTTON_CLASS} onClick={onRotate} disabled={disabled}>
          Change signer
        </Button>
      </div>
      <div className={`${KV_CLASS} border-b-0`}>
        <span>Signer public key</span>
        <b className="font-mono text-xs font-normal text-text-hi" title={signer}>
          {signer ? shortAddress(signer) : "—"}
        </b>
      </div>
    </div>
  );
}
