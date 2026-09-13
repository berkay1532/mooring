import type { Wallet } from "../chain/card";

/**
 * The shape every wallet implementation satisfies: a real Freighter adapter
 * ({@link ../freighter}) and a fixed-address mock for tests and local dev
 * without the extension ({@link ../mock}). `lib/wallet/context.tsx` picks
 * one per `config.walletMode` and exposes it (and the derived connection
 * state) through `useWallet()`.
 */
export interface WalletAdapter {
  id: "freighter" | "mock";
  isAvailable(): Promise<boolean>;
  connect(): Promise<{ address: string }>;
  disconnect(): Promise<void>;
  getAddress(): Promise<string | null>;
  getNetworkPassphrase(): Promise<string | null>;
  signTransaction(
    xdr: string,
    opts: { networkPassphrase: string; address: string },
  ): Promise<string>;
  onChange?(cb: (s: { address: string | null; networkPassphrase: string | null }) => void): () => void;
}

/**
 * Bridges a {@link WalletAdapter} (this task's interface, `signTransaction`
 * returning the signed XDR string) to `lib/chain/card.ts`'s `Wallet`
 * (Freighter's own return shape, `{ signedTxXdr, signerAddress? }`), so
 * `useWallet()` can hand a ready-to-use `Wallet` straight to the tx builders
 * (`buildSetPolicy`, `buildFreeze`, …) without those builders knowing this
 * interface exists.
 */
export function toWallet(adapter: WalletAdapter, address: string): Wallet {
  return {
    publicKey: address,
    async signTransaction(xdr, opts) {
      const signedTxXdr = await adapter.signTransaction(xdr, {
        networkPassphrase: opts.networkPassphrase,
        address: opts.address ?? address,
      });
      return { signedTxXdr, signerAddress: address };
    },
  };
}

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * A short, human name for a network passphrase, for copy that must not
 * hardcode "Testnet" (the app may one day point at another network):
 * the well-known testnet passphrase becomes "Testnet"; anything else falls
 * back to the passphrase's first word (e.g. the mainnet passphrase's
 * "Public").
 */
export function networkLabel(passphrase: string): string {
  if (passphrase === TESTNET_PASSPHRASE) return "Testnet";
  return passphrase.split(" ")[0] || passphrase;
}
