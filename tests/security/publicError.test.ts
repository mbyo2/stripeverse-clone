// Pins for the Workstream D (2026-11-15) crafted-error gate.
//
// The CEO error-presentation rule: a client must never see a raw
// browser-style/system response. Money-path edge functions used to
// return raw Postgres / provider error text (live-proven 2026-11-15:
// atomic-transfer returned the wallets FK constraint text for a
// transfer to a nonexistent user). The shared gate in
// supabase/functions/_shared/public-error.ts is now the only way a
// caught error reaches a response: our own RPC RAISE EXCEPTIONs
// (code P0001) pass through, our own crafted throws pass through
// when allowlisted at the call site, everything else collapses to
// the caller's generic fallback.
import { describe, it, expect } from "vitest";
import {
  publicErrorMessage,
  throwRpcError,
} from "../../supabase/functions/_shared/public-error";

const payload = `<img src=x onerror="window.__WSD_XSS__=1">`;

describe("publicErrorMessage", () => {
  it("passes a P0001 (crafted RPC refusal) through, Error and plain-object shapes", () => {
    const err = new Error("Insufficient balance: have 0.00, need 1.03");
    (err as Error & { code?: string }).code = "P0001";
    expect(publicErrorMessage(err, "Transfer failed")).toBe(
      "Insufficient balance: have 0.00, need 1.03",
    );
    // PostgREST errors are plain objects, not Error instances.
    expect(
      publicErrorMessage(
        { message: "Insufficient balance: have 0.00, need 1.03", code: "P0001" },
        "Transfer failed",
      ),
    ).toBe("Insufficient balance: have 0.00, need 1.03");
  });

  it("collapses a non-P0001 database error to the generic fallback", () => {
    expect(
      publicErrorMessage(
        {
          message:
            'insert or update on table "wallets" violates foreign key constraint "wallets_user_id_fkey"',
          code: "23503",
        },
        "Transfer failed",
      ),
    ).toBe("Transfer failed");
    const pg = new Error('invalid input syntax for type uuid: "not-a-uuid"');
    (pg as Error & { code?: string }).code = "22P02";
    expect(publicErrorMessage(pg, "Transfer failed")).toBe("Transfer failed");
  });

  it("passes an allowlisted crafted throw, rejects anything else", () => {
    expect(
      publicErrorMessage(new Error("Cannot transfer to yourself"), "Transfer failed", [
        "Cannot transfer to yourself",
      ]),
    ).toBe("Cannot transfer to yourself");
    expect(
      publicErrorMessage(new Error("some new internal text"), "Transfer failed", [
        "Cannot transfer to yourself",
      ]),
    ).toBe("Transfer failed");
  });

  it("never returns the raw message for non-Error values", () => {
    expect(publicErrorMessage("raw string", "Transfer failed")).toBe("Transfer failed");
    expect(publicErrorMessage(null, "Transfer failed")).toBe("Transfer failed");
    expect(publicErrorMessage(undefined, "Transfer failed")).toBe("Transfer failed");
  });
});

describe("throwRpcError", () => {
  it("preserves a P0001 message and code", () => {
    try {
      throwRpcError({ message: "Daily limit exceeded", code: "P0001" }, "Transfer failed");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe("Daily limit exceeded");
      expect((e as { code?: string }).code).toBe("P0001");
    }
  });

  it("replaces any other database error with the fallback", () => {
    try {
      throwRpcError(
        { message: 'relation "wallets" does not exist', code: "42P01" },
        "Transfer failed",
      );
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe("Transfer failed");
    }
  });
});

describe("stored payloads stay inert through the gate", () => {
  it("a stored-XSS payload is not a crafted message and collapses to the fallback", () => {
    expect(publicErrorMessage(new Error(payload), "Transfer failed")).toBe("Transfer failed");
  });
});
