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
  it("returns the function's own error message from the response body", async () => {
    const error = httpError({ error: "permission denied for function execute_atomic_transfer" });
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe(
      "permission denied for function execute_atomic_transfer",
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

  it("keeps a specific invoke message when there is no readable body", async () => {
    const error = new Error("Failed to send a request to the Edge Function");
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe(
      "Failed to send a request to the Edge Function",
    );
  });

  it("returns the fallback for non-error values", async () => {
    await expect(resolveEdgeFunctionError(null, "Transfer failed")).resolves.toBe("Transfer failed");
    await expect(resolveEdgeFunctionError(undefined, "Transfer failed")).resolves.toBe("Transfer failed");
  });
});
