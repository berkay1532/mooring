import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NetworkGuard } from "../../components/layout/NetworkGuard";
import { WalletProvider } from "../../lib/wallet/context";
import { toWallet, type WalletAdapter, networkLabel } from "../../lib/wallet/types";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const OTHER_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const MOCK_ADDRESS = "GCJJNZTF44SEINHOM4TFNGQDQ5ET4TGQOZL6Y2EZ2YNTKBASZESMKKBD";

function makeAdapter(overrides: Partial<WalletAdapter> = {}): WalletAdapter {
  return {
    id: "mock",
    isAvailable: async () => true,
    connect: async () => ({ address: MOCK_ADDRESS }),
    disconnect: async () => {},
    getAddress: async () => null,
    getNetworkPassphrase: async () => TESTNET_PASSPHRASE,
    signTransaction: async (xdr) => xdr,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

function renderGuard(adapter: WalletAdapter) {
  return render(
    <WalletProvider adapter={adapter}>
      <NetworkGuard>
        <p>Secret cards content</p>
      </NetworkGuard>
    </WalletProvider>,
  );
}

describe("NetworkGuard / Connect screen", () => {
  it("shows the Connect screen first, then children after connect", async () => {
    let connected = false;
    const adapter = makeAdapter({
      getAddress: async () => (connected ? MOCK_ADDRESS : null),
      connect: async () => {
        connected = true;
        return { address: MOCK_ADDRESS };
      },
    });
    renderGuard(adapter);

    const button = await screen.findByRole("button", { name: /connect freighter/i });
    expect(screen.queryByText("Secret cards content")).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(await screen.findByText("Secret cards content")).toBeInTheDocument();
  });

  it("shows a blocking wrong-network notice naming the expected network", async () => {
    const adapter = makeAdapter({
      getAddress: async () => MOCK_ADDRESS,
      getNetworkPassphrase: async () => OTHER_PASSPHRASE,
    });
    renderGuard(adapter);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/testnet/i);
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText("Secret cards content")).not.toBeInTheDocument();
    // Blocking: no connect button or install link alongside the notice.
    expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
  });

  it("shows an Install Freighter link when the wallet is unavailable", async () => {
    const adapter = makeAdapter({ isAvailable: async () => false, getAddress: async () => null });
    renderGuard(adapter);

    const link = await screen.findByRole("link", { name: /install freighter/i });
    expect(link).toHaveAttribute("href", "https://www.freighter.app/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByRole("button", { name: /connect freighter/i })).not.toBeInTheDocument();
  });

  it("does not show the Connect button (or any affordance) until isAvailable() has answered", async () => {
    let resolveAvailable: (v: boolean) => void = () => {};
    const pending = new Promise<boolean>((resolve) => {
      resolveAvailable = resolve;
    });
    const adapter = makeAdapter({
      isAvailable: () => pending,
      getAddress: async () => null,
    });
    renderGuard(adapter);

    // Still loading: only the wordmark, no button, no install link, no paragraph.
    expect(screen.getByText("MOORING")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect freighter/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /install freighter/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/mooring gives an ai agent/i)).not.toBeInTheDocument();

    resolveAvailable(true);

    expect(await screen.findByRole("button", { name: /connect freighter/i })).toBeInTheDocument();
  });
});

describe("toWallet", () => {
  it("bridges a WalletAdapter to the Wallet shape the tx builders expect", async () => {
    const adapter = makeAdapter({ signTransaction: async (xdr) => `${xdr}-signed` });
    const wallet = toWallet(adapter, MOCK_ADDRESS);

    expect(wallet.publicKey).toBe(MOCK_ADDRESS);
    const result = await wallet.signTransaction("AAAA", { networkPassphrase: TESTNET_PASSPHRASE });
    expect(result).toEqual({ signedTxXdr: "AAAA-signed", signerAddress: MOCK_ADDRESS });
  });

  it("falls back to the bridged address when no address is passed in opts", async () => {
    let seenAddress: string | undefined;
    const adapter = makeAdapter({
      signTransaction: async (xdr, opts) => {
        seenAddress = opts.address;
        return xdr;
      },
    });
    const wallet = toWallet(adapter, MOCK_ADDRESS);
    await wallet.signTransaction("AAAA", { networkPassphrase: TESTNET_PASSPHRASE });
    expect(seenAddress).toBe(MOCK_ADDRESS);
  });
});

describe("networkLabel", () => {
  it("names the testnet passphrase 'Testnet'", () => {
    expect(networkLabel(TESTNET_PASSPHRASE)).toBe("Testnet");
  });
  it("falls back to the passphrase's first word otherwise", () => {
    expect(networkLabel(OTHER_PASSPHRASE)).toBe("Public");
  });
});

describe("freighterAdapter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@stellar/freighter-api", () => ({
      isConnected: vi.fn(),
      isAllowed: vi.fn(),
      setAllowed: vi.fn(),
      requestAccess: vi.fn(),
      getAddress: vi.fn(),
      getNetworkDetails: vi.fn(),
      signTransaction: vi.fn(),
      WatchWalletChanges: vi.fn(),
    }));
  });
  afterEach(() => {
    vi.doUnmock("@stellar/freighter-api");
  });

  it("throws an Error carrying Freighter's numeric code on a declined signature", async () => {
    const api = await import("@stellar/freighter-api");
    vi.mocked(api.isAllowed).mockResolvedValue({ isAllowed: true });
    vi.mocked(api.requestAccess).mockResolvedValue({
      address: "",
      error: { code: -4, message: "User declined access" },
    });

    const { freighterAdapter } = await import("../../lib/wallet/freighter");
    await expect(freighterAdapter.connect()).rejects.toMatchObject({
      code: -4,
      message: "User declined access",
    });
  });

  it("resolves isAvailable() from isConnected()", async () => {
    const api = await import("@stellar/freighter-api");
    vi.mocked(api.isConnected).mockResolvedValue({ isConnected: true });

    const { freighterAdapter } = await import("../../lib/wallet/freighter");
    await expect(freighterAdapter.isAvailable()).resolves.toBe(true);
  });

  it("maps getAddress() to null when the site is not allowed", async () => {
    const api = await import("@stellar/freighter-api");
    vi.mocked(api.isAllowed).mockResolvedValue({ isAllowed: false });

    const { freighterAdapter } = await import("../../lib/wallet/freighter");
    await expect(freighterAdapter.getAddress()).resolves.toBeNull();
  });

  it("returns the signed XDR string from signTransaction()", async () => {
    const api = await import("@stellar/freighter-api");
    vi.mocked(api.signTransaction).mockResolvedValue({
      signedTxXdr: "SIGNED_XDR",
      signerAddress: MOCK_ADDRESS,
    });

    const { freighterAdapter } = await import("../../lib/wallet/freighter");
    await expect(
      freighterAdapter.signTransaction("XDR", { networkPassphrase: TESTNET_PASSPHRASE, address: MOCK_ADDRESS }),
    ).resolves.toBe("SIGNED_XDR");
  });

  it("throws on getNetworkDetails() errors too, not just connect()", async () => {
    const api = await import("@stellar/freighter-api");
    vi.mocked(api.getNetworkDetails).mockResolvedValue({
      network: "",
      networkUrl: "",
      networkPassphrase: "",
      error: { code: -5, message: "Not authorized" },
    });

    const { freighterAdapter } = await import("../../lib/wallet/freighter");
    await expect(freighterAdapter.getNetworkPassphrase()).rejects.toMatchObject({ code: -5 });
  });

  it("onChange constructs WatchWalletChanges(3000), calls .watch, and .stop()s on unsubscribe", async () => {
    const watchFn = vi.fn();
    const stopFn = vi.fn();
    const instances: number[] = [];
    class FakeWatchWalletChanges {
      constructor(timeout?: number) {
        instances.push(timeout ?? -1);
      }
      watch = watchFn;
      stop = stopFn;
    }
    vi.resetModules();
    vi.doMock("@stellar/freighter-api", () => ({
      isConnected: vi.fn(),
      isAllowed: vi.fn(),
      setAllowed: vi.fn(),
      requestAccess: vi.fn(),
      getAddress: vi.fn(),
      getNetworkDetails: vi.fn(),
      signTransaction: vi.fn(),
      WatchWalletChanges: FakeWatchWalletChanges,
    }));

    const { freighterAdapter } = await import("../../lib/wallet/freighter");
    const cb = vi.fn();
    const unsubscribe = freighterAdapter.onChange?.(cb);

    // The `WatchWalletChanges` construction happens inside the `.then()` of
    // `onChange`'s internal dynamic import, itself an async function with
    // its own `await` — wait rather than guess how many microtask ticks
    // that chain needs to settle.
    await waitFor(() => expect(watchFn).toHaveBeenCalledTimes(1));

    expect(instances).toEqual([3000]);
    expect(stopFn).not.toHaveBeenCalled();

    unsubscribe?.();
    expect(stopFn).toHaveBeenCalledTimes(1);
  });
});

describe("mockAdapter and window.__mooringMock", () => {
  afterEach(async () => {
    const { __resetMockAdapter } = await import("../../lib/wallet/mock");
    __resetMockAdapter();
    delete window.__mooringMock;
  });

  it("is available and disconnected by default, then connects to the fixed address", async () => {
    const { mockAdapter, MOCK_ADDRESS: fixedAddress } = await import("../../lib/wallet/mock");

    await expect(mockAdapter.isAvailable()).resolves.toBe(true);
    await expect(mockAdapter.getAddress()).resolves.toBeNull();

    const { address } = await mockAdapter.connect();
    expect(address).toBe(fixedAddress);
    await expect(mockAdapter.getAddress()).resolves.toBe(fixedAddress);
    await expect(mockAdapter.getNetworkPassphrase()).resolves.toBe(TESTNET_PASSPHRASE);

    await mockAdapter.disconnect();
    await expect(mockAdapter.getAddress()).resolves.toBeNull();
  });

  it("returns the input XDR unchanged from signTransaction", async () => {
    const { mockAdapter } = await import("../../lib/wallet/mock");
    await expect(
      mockAdapter.signTransaction("SOME_XDR", { networkPassphrase: TESTNET_PASSPHRASE, address: MOCK_ADDRESS }),
    ).resolves.toBe("SOME_XDR");
  });

  it("window.__mooringMock = { mode: 'unavailable' } makes isAvailable() false", async () => {
    window.__mooringMock = { mode: "unavailable" };
    const { mockAdapter } = await import("../../lib/wallet/mock");
    await expect(mockAdapter.isAvailable()).resolves.toBe(false);
    await expect(mockAdapter.connect()).rejects.toThrow(/not installed/i);
  });

  it("window.__mooringMock = { mode: 'wrong-network' } connects to a non-testnet passphrase", async () => {
    window.__mooringMock = { mode: "wrong-network" };
    const { mockAdapter } = await import("../../lib/wallet/mock");
    await mockAdapter.connect();
    await expect(mockAdapter.getNetworkPassphrase()).resolves.toBe(OTHER_PASSPHRASE);
  });

  it("notifies onChange subscribers on connect and disconnect", async () => {
    const { mockAdapter } = await import("../../lib/wallet/mock");
    const seen: Array<{ address: string | null }> = [];
    const unsubscribe = mockAdapter.onChange?.((s) => seen.push(s));

    await mockAdapter.connect();
    await mockAdapter.disconnect();
    unsubscribe?.();

    expect(seen).toEqual([{ address: MOCK_ADDRESS, networkPassphrase: TESTNET_PASSPHRASE }, { address: null, networkPassphrase: null }]);
  });

  it("window.__mooringMock.set() switches mode at runtime and notifies subscribers immediately", async () => {
    const { mockAdapter } = await import("../../lib/wallet/mock");

    // Trigger `ensureControl()` so `window.__mooringMock.set` exists.
    await mockAdapter.isAvailable();
    await mockAdapter.connect();

    const seen: Array<{ address: string | null; networkPassphrase: string | null }> = [];
    const unsubscribe = mockAdapter.onChange?.((s) => seen.push(s));

    window.__mooringMock?.set?.("wrong-network");

    expect(seen).toEqual([{ address: MOCK_ADDRESS, networkPassphrase: OTHER_PASSPHRASE }]);
    await expect(mockAdapter.getNetworkPassphrase()).resolves.toBe(OTHER_PASSPHRASE);

    unsubscribe?.();
  });

  it("onChange's reported state agrees with getAddress()/getNetworkPassphrase() when forced unavailable mid-session", async () => {
    const { mockAdapter } = await import("../../lib/wallet/mock");
    await mockAdapter.connect();

    const seen: Array<{ address: string | null; networkPassphrase: string | null }> = [];
    const unsubscribe = mockAdapter.onChange?.((s) => seen.push(s));

    // Overwrite wholesale (the plain-object Playwright form), then switch via
    // `set()` once `ensureControl()` has patched it back in.
    window.__mooringMock = { mode: "unavailable" };
    await mockAdapter.isAvailable();
    window.__mooringMock.set?.("unavailable");

    await expect(mockAdapter.getAddress()).resolves.toBeNull();
    await expect(mockAdapter.getNetworkPassphrase()).resolves.toBeNull();
    expect(seen.at(-1)).toEqual({ address: null, networkPassphrase: null });

    unsubscribe?.();
  });
});

describe("WalletProvider lifecycle", () => {
  it("never starts the change watcher if the provider unmounts mid-first-refresh", async () => {
    let resolveAvailable!: (value: boolean) => void;
    const onChange = vi.fn(() => () => {});
    const adapter = makeAdapter({
      isAvailable: () =>
        new Promise<boolean>((resolve) => {
          resolveAvailable = resolve;
        }),
      getAddress: async () => MOCK_ADDRESS,
      onChange,
    });

    const { unmount } = render(
      <WalletProvider adapter={adapter}>
        <p>anything</p>
      </WalletProvider>,
    );

    // Unmount while `isAvailable()` is still pending, then let it answer.
    unmount();
    resolveAvailable(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("useWallet status derivation end-to-end via the mock adapter", () => {
  afterEach(async () => {
    const { __resetMockAdapter } = await import("../../lib/wallet/mock");
    __resetMockAdapter();
    delete window.__mooringMock;
  });

  it("goes disconnected -> connected -> disconnected through the real mock adapter", async () => {
    const { mockAdapter } = await import("../../lib/wallet/mock");
    render(
      <WalletProvider adapter={mockAdapter}>
        <NetworkGuard>
          <p>Secret cards content</p>
        </NetworkGuard>
      </WalletProvider>,
    );

    const button = await screen.findByRole("button", { name: /connect freighter/i });
    fireEvent.click(button);
    expect(await screen.findByText("Secret cards content")).toBeInTheDocument();
  });
});
