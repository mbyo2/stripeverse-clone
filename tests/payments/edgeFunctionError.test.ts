// Unit tests for src/utils/edgeFunctionError.ts — the helper that
// turns a failed functions.invoke into the message a user should
// actually see. The regression being pinned: edge functions return
// { error: "<real reason>" } with a non-2xx status, and supabase-js
// hides that behind the generic "Edge Function returned a non-2xx
// status code" — so send failures reached the user with no real
// explanation (Money QA Round 2).

import { describe, it, expect } from "vitest";
import { resolveEdgeFunctionError } from "../../src/utils/edgeFunctionError";

function httpError(payload: unknown, message = "Edge Function returned a non-2xx status code") {
  return {
    name: "FunctionsHttpError",
    message,
    context: {
      json: async () => payload,
      clone() {
        return this;
      },
    },
  };
}

describe("resolveEdgeFunctionError", () => {
  it("surfaces the real reason from the body — never the generic invoke text", async () => {
    // The body's reason drives what the user sees, but raw system
    // wording is presented as crafted plain language (CEO
    // error-presentation rule, 2026-10-22): the Postgres refusal
    // becomes the permission message, not the verbatim string.
    const error = httpError({ error: "permission denied for function execute_atomic_transfer" });
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe(
      "You don't have permission to do that. If you believe this is a mistake, please contact support.",
    );
  });

  it("passes a crafted server message from the body through unchanged", async () => {
    const error = httpError({ error: "Insufficient balance in your ZMW wallet" });
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe(
      "Insufficient balance in your ZMW wallet",
    );
  });

  it("falls back when the body has no error field", async () => {
    const error = httpError({ success: false });
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe("Transfer failed");
  });

  it("falls back when the body is not JSON", async () => {
    const error = {
      message: "Edge Function returned a non-2xx status code",
      context: {
        json: async () => {
          throw new Error("invalid json");
        },
        clone() {
          return this;
        },
      },
    };
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe("Transfer failed");
  });

  it("maps a transport failure to the plain connection message", async () => {
    const error = new Error("Failed to send a request to the Edge Function");
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe(
      "We couldn't reach BMaGlass Pay. Check your internet connection and try again.",
    );
  });

  it("returns the fallback for non-error values", async () => {
    await expect(resolveEdgeFunctionError(null, "Transfer failed")).resolves.toBe("Transfer failed");
    await expect(resolveEdgeFunctionError(undefined, "Transfer failed")).resolves.toBe("Transfer failed");
  });
});
