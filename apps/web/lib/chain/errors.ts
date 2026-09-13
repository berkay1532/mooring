import { CARD_ERRORS } from "@mooring/x402-client";

/** A user-facing translation of a thrown wallet/RPC/contract error. */
export interface TranslatedError {
  title: string;
  detail?: string;
  next?: string;
  code?: number;
}

const CONTRACT_ERROR_RE = /Error\(Contract,\s*#(\d+)\)/;
const AUTH_ERROR_RE = /Error\(Auth,/;
/**
 * The SAC's own `BalanceError` (#10) diagnostic text — `soroban-env-host`'s
 * `stellar_asset_contract::balance` raises this exact phrase (also, on a
 * zero balance, "zero balance is not sufficient to spend", which this regex
 * still matches). The card never emits this text, only the token contract
 * does, so it is what actually "names the token contract" in the diagnostic.
 */
const SAC_BALANCE_RE = /balance is not sufficient to spend/i;

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const withMessage = (err as { message?: unknown }).message;
    if (typeof withMessage === "string") return withMessage;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return err === undefined || err === null ? "" : String(err);
}

function codeOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "number") return c;
  }
  return undefined;
}

/**
 * Translates an unknown thrown value — a Freighter API error, a Soroban RPC
 * simulation failure, a raw string, or anything else — into a short
 * user-facing message.
 *
 * Never throws: every input shape (Error, plain object, string, number,
 * null/undefined) is handled explicitly and falls back to a generic message
 * rather than raising.
 *
 * `opts.token`, when given (the USDC SAC address), lets the `#10` collision
 * below be resolved by contract identity — `contract:<token>, topics:[error,
 * Error(Contract, #10)]` — rather than only by the SAC's diagnostic phrase.
 */
export function translateError(err: unknown, opts?: { token?: string }): TranslatedError {
  const message = messageOf(err);
  const code = codeOf(err);
  const mentionsFreighter = /freighter/i.test(message);

  // Freighter: the user declined the signing/connection request.
  if (code === -4 || /user declined/i.test(message)) {
    return {
      title: "Signing request declined",
      detail: "You declined the request in Freighter.",
      next: "Try again and approve the request in your wallet to continue.",
    };
  }

  // Freighter: extension not installed.
  if (mentionsFreighter && /not installed/i.test(message)) {
    return {
      title: "Freighter not found",
      detail: "The Freighter wallet extension is not installed.",
      next: "Install Freighter and reload the page.",
    };
  }

  // Freighter: extension installed but this site is not authorized.
  if (
    mentionsFreighter &&
    (/not (been )?granted/i.test(message) || /not allowed/i.test(message) || /access denied/i.test(message))
  ) {
    return {
      title: "Freighter access needed",
      detail: "This site is not allowed to access your Freighter wallet.",
      next: "Open Freighter, allow this site, and try again.",
    };
  }

  // Wallet connected to the wrong Stellar network.
  if (/wrong network|network mismatch|switch.*network/i.test(message)) {
    return {
      title: "Wrong network",
      detail: message,
      next: "Switch your wallet to the Stellar network this app uses and try again.",
    };
  }

  // Soroban contract error, e.g. "HostError: Error(Contract, #11)".
  const contractMatch = CONTRACT_ERROR_RE.exec(message);
  if (contractMatch) {
    const errCode = Number(contractMatch[1]);
    // The card and the USDC token contract both use small integer error
    // codes, and #10 collides: on the card it means "allowlist full", but a
    // SAC `transfer` also raises #10 for an insufficient balance. Only the
    // diagnostic text (or, with `opts.token`, contract identity) tells them
    // apart — the card's own denial never carries the SAC's balance phrase.
    const isSacBalanceFailure =
      errCode === 10 &&
      (SAC_BALANCE_RE.test(message) ||
        (opts?.token !== undefined &&
          message.includes(`contract:${opts.token}, topics:[error, Error(Contract, #10)]`)));
    if (isSacBalanceFailure) {
      return {
        title: "Insufficient USDC balance",
        detail: "The card does not hold enough USDC to cover this payment.",
        code: errCode,
      };
    }
    return {
      title: CARD_ERRORS[errCode] ?? "The card rejected this action.",
      code: errCode,
    };
  }

  // Soroban auth failure not attributable to a specific contract error code.
  if (AUTH_ERROR_RE.test(message)) {
    return {
      title: "Not authorized by the owner",
      detail: "This action was not signed the way the card's policy requires.",
    };
  }

  // Fallback: unrecognized error shape.
  return {
    title: "Something went wrong",
    detail: message || undefined,
  };
}
