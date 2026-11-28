import { Keypair } from "@stellar/stellar-sdk";

/**
 * A signed record of one payment attempt, made by the agent that attempted it.
 * Amounts are USDC base units. `sig` is the agent key's ed25519 signature
 * (hex) over `canonicalReceipt(receipt)`.
 */
export interface Receipt {
  v: 1;
  id: string;
  ts: string;
  protocol: "x402" | "mpp";
  card: string;
  agent: string;
  payTo: string;
  amount: string;
  asset: string;
  network: string;
  url?: string;
  status: "settled" | "denied" | "failed";
  txHash?: string;
  reason?: string;
  sig: string;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonical(v))).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The signed bytes' source: JSON with keys sorted recursively, no whitespace, `sig` left out. */
export function canonicalReceipt(r: Omit<Receipt, "sig">): string {
  const { sig: _sig, ...rest } = r as Receipt;
  return canonical(rest);
}

/** Signs a receipt with the agent key. */
export function signReceipt(r: Omit<Receipt, "sig">, agent: Keypair): Receipt {
  const { sig: _sig, ...rest } = r as Receipt;
  const sig = toHex(agent.sign(new TextEncoder().encode(canonicalReceipt(rest))));
  return { ...rest, sig };
}

/** True when `sig` is `agent`'s signature over the receipt. Never throws. */
export function verifyReceipt(r: Receipt): boolean {
  try {
    return Keypair.fromPublicKey(r.agent).verify(
      new TextEncoder().encode(canonicalReceipt(r)),
      fromHex(r.sig),
    );
  } catch {
    return false;
  }
}

/** A fresh receipt id: 16 random bytes, hex. */
export function receiptId(): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}
