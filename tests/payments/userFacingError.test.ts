// Unit tests for src/utils/userFacingError.ts — the mapper behind
// the CEO's error-presentation rule (2026-10-22): the app must NEVER
// show a raw browser-style / system response. Technical text is
// replaced with crafted plain language; messages our own backend and
// client already wrote for humans pass through unchanged.

import { describe, it, expect } from "vitest";
import { toUserFacingError, DEFAULT_ERROR_MESSAGE } from "../../src/utils/userFacingError";

const NETWORK =
  "We couldn't reach BMaGlass Pay. Check your internet connection and try again.";
const SESSION = "Your session has expired. Please sign in again to continue.";
const RATE =
  "Too many attempts in a short space of time. Please wait a moment, then try again.";
const PERMISSION =
  "You don't have permission to do that. If you believe this is a mistake, please contact support.";

describe("toUserFacingError — technical text is mapped", () => {
  it("maps fetch / network failures to the connection message", () => {
    expect(toUserFacingError(new Error("Failed to fetch"))).toBe(NETWORK);
    expect(toUserFacingError(new TypeError("Failed to fetch"))).toBe(NETWORK);
    expect(toUserFacingError("NetworkError when attempting to fetch resource.")).toBe(NETWORK);
    expect(toUserFacingError(new Error("Failed to send a request to the Edge Function"))).toBe(
      NETWORK,
    );
  });

  it("maps timeouts to the timeout message", () => {
    expect(toUserFacingError(new Error("The request timed out"))).toBe(
      "That took too long to finish. Check your connection and try again.",
    );
    expect(toUserFacingError(new Error("AbortError: The user aborted a request"))).toBe(
      "That took too long to finish. Check your connection and try again.",
    );
  });

  it("maps expired / missing sessions to the sign-in message", () => {
    expect(toUserFacingError({ message: "JWT expired", code: "PGRST301" })).toBe(SESSION);
    expect(toUserFacingError(new Error("Auth session missing!"))).toBe(SESSION);
    expect(toUserFacingError(new Error("User not authenticated"))).toBe(SESSION);
    expect(toUserFacingError(new Error("Invalid Refresh Token: Already Used"))).toBe(SESSION);
  });

  it("maps rate limits", () => {
    expect(toUserFacingError(new Error("Request rate limit reached"))).toBe(RATE);
    expect(toUserFacingError(new Error("over_email_send_rate_limit"))).toBe(RATE);
    expect(toUserFacingError("Too many requests")).toBe(RATE);
  });

  it("maps permission / RLS refusals", () => {
    expect(
      toUserFacingError(new Error("permission denied for function execute_atomic_transfer")),
    ).toBe(PERMISSION);
    expect(
      toUserFacingError({
        message: 'new row violates row-level security policy for table "wallets"',
        code: "42501",
      }),
    ).toBe(PERMISSION);
  });

  it("maps duplicate-key conflicts", () => {
    expect(
      toUserFacingError(
        new Error('duplicate key value violates unique constraint "subaccounts_name_key"'),
      ),
    ).toBe(
      "That already exists — it may have been saved already. Check first, and try again if needed.",
    );
  });

  it("collapses other Postgres / PostgREST wording to the caller's fallback", () => {
    const fb = "Transfer failed. Please try again.";
    expect(toUserFacingError({ message: 'relation "public.foo" does not exist' }, fb)).toBe(fb);
    expect(toUserFacingError(new Error('null value in column "user_id" violates not-null constraint'), fb)).toBe(fb);
    expect(toUserFacingError({ message: "Could not find the function public.f in the schema cache" }, fb)).toBe(fb);
    expect(toUserFacingError(new Error("invalid input syntax for type numeric"), fb)).toBe(fb);
  });

  it("collapses invoke generics and HTTP status dumps to the fallback", () => {
    const fb = "Payment failed. Please try again.";
    expect(toUserFacingError(new Error("Edge Function returned a non-2xx status code"), fb)).toBe(fb);
    expect(toUserFacingError(new Error("Request failed with status code 500"), fb)).toBe(fb);
  });

  it("collapses JS runtime exceptions, JSON dumps and stack traces to the fallback", () => {
    expect(toUserFacingError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(
      DEFAULT_ERROR_MESSAGE,
    );
    expect(toUserFacingError('{"code":"42501","message":"permission denied"}')).toBe(
      DEFAULT_ERROR_MESSAGE,
    );
    expect(
      toUserFacingError(new Error("Boom\n    at HTMLUnknownElement.callCallback (react-dom.js:1:1)")),
    ).toBe(DEFAULT_ERROR_MESSAGE);
    expect(toUserFacingError("x".repeat(400))).toBe(DEFAULT_ERROR_MESSAGE);
  });

  it("returns the fallback for values with no usable message", () => {
    expect(toUserFacingError(null)).toBe(DEFAULT_ERROR_MESSAGE);
    expect(toUserFacingError(undefined)).toBe(DEFAULT_ERROR_MESSAGE);
    expect(toUserFacingError({})).toBe(DEFAULT_ERROR_MESSAGE);
    expect(toUserFacingError(42)).toBe(DEFAULT_ERROR_MESSAGE);
    expect(toUserFacingError(new Error(""))).toBe(DEFAULT_ERROR_MESSAGE);
    expect(toUserFacingError(null, "Send failed. Please try again.")).toBe(
      "Send failed. Please try again.",
    );
  });
});

describe("toUserFacingError — crafted messages pass through unchanged", () => {
  it("keeps our own backend's plain-language refusals", () => {
    expect(toUserFacingError(new Error("Insufficient balance"))).toBe("Insufficient balance");
    expect(toUserFacingError(new Error("Sub-account limit reached for your plan (3)"))).toBe(
      "Sub-account limit reached for your plan (3)",
    );
    expect(
      toUserFacingError(
        new Error("Virtual cards are coming soon — they're not available yet."),
      ),
    ).toBe("Virtual cards are coming soon — they're not available yet.");
    expect(
      toUserFacingError(
        new Error(
          "Lightning deposits are not available yet — please use an on-chain Bitcoin deposit for now.",
        ),
      ),
    ).toBe(
      "Lightning deposits are not available yet — please use an on-chain Bitcoin deposit for now.",
    );
    expect(
      toUserFacingError(
        new Error("You can withdraw up to $12.00 to PayPal — that's the total PayPal has paid you."),
      ),
    ).toBe("You can withdraw up to $12.00 to PayPal — that's the total PayPal has paid you.");
  });

  it("keeps GoTrue's human auth wording", () => {
    expect(toUserFacingError(new Error("Invalid login credentials"))).toBe(
      "Invalid login credentials",
    );
    expect(toUserFacingError(new Error("Email not confirmed"))).toBe("Email not confirmed");
    expect(toUserFacingError(new Error("User already registered"))).toBe("User already registered");
    expect(toUserFacingError(new Error("Password should be at least 6 characters"))).toBe(
      "Password should be at least 6 characters",
    );
  });

  it("keeps ordinary client-written sentences and plain strings", () => {
    expect(toUserFacingError("Payment link not found or expired")).toBe(
      "Payment link not found or expired",
    );
    expect(toUserFacingError(new Error("No ZMW wallet — fund your wallet first"))).toBe(
      "No ZMW wallet — fund your wallet first",
    );
    expect(toUserFacingError(new Error("Quote expired"))).toBe("Quote expired");
  });
});
