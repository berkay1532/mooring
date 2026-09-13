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
/** Present on SAC/token diagnostics but not on the card's own error text. */
const TOKEN_HINT_RE = /token/i;

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
 */
export function translateError(err: unknown): TranslatedError {
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
    // diagnostic text tells them apart — a token-contract failure names the
    // token, the card's own denial never does.
    if (errCode === 10 && TOKEN_HINT_RE.test(message)) {
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
