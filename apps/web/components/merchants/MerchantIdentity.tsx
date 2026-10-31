import { shortAddress } from "@/lib/format/address";
import type { MerchantLabel } from "@/lib/prefs";

export interface MerchantIdentityProps {
  address: string;
  /** The owner-approved name for this address, when one is stored. */
  label?: MerchantLabel;
  /**
   * Inline form for a summary sentence: the name and a shortened address on
   * one line, and a shortened address (not the full one) when unnamed.
   */
  inline?: boolean;
}

/**
 * How a merchant is shown in a list: its approved name above the shortened
 * address (full address on hover), or the full address when it has no name.
 */
export function MerchantIdentity({ address, label, inline }: MerchantIdentityProps) {
  if (inline) {
    return label ? (
      <>
        <span>{label.name}</span>{" "}
        <span className="font-mono text-text-lo" title={address}>
          {shortAddress(address)}
        </span>
      </>
    ) : (
      <span className="font-mono" title={address}>
        {shortAddress(address)}
      </span>
    );
  }
  return label ? (
    <span className="min-w-0">
      <span className="block truncate text-sm text-text-hi">{label.name}</span>
      <span className="block truncate font-mono text-xs text-text-lo" title={address}>
        {shortAddress(address)}
      </span>
    </span>
  ) : (
    <span className="min-w-0 truncate font-mono text-xs text-text-hi" title={address}>
      {address}
    </span>
  );
}
