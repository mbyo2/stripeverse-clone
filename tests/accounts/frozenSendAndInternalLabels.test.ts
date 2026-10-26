// Workstream C (2026-10-26) — frozen-send messages + internal-transfer
// history labels.
//
// Paper cut 1: a send/transfer from a frozen account was refused
// SILENTLY. Two mechanisms caused it:
//   (a) the internal-transfer RPC's refusal was the raw
//       "Source account is frozen and cannot send" — no remedy; and
//   (b) most fiat send paths threw only the invoke error's generic
//       message ("Edge Function returned a non-2xx status code"),
//       DISCARDING the function's response body, so even the crafted
//       server refusal (profile freeze) never reached the user —
//       toUserFacingError then mapped the generic text to a fallback.
// Paper cut 2: internal-transfer rows carried NULL descriptions, so
// history lists could not name the counterparty account (the
// receiving side read "Received from Unknown"). The RPC now writes
// "Transfer to <destination>" / "Transfer from <source>" when no
// note is supplied (migration 20261214).
//
// These tests pin the client mapping, the body-extraction wiring in
// every fixed caller, the SubAccounts frozen guard, the shared
// labelling of the new descriptions, the QuickActions wiring, and
// the migration's SQL at source level (the repo's SQL-proof pattern).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  toUserFacingError,
  FROZEN_SUB_ACCOUNT_MESSAGE,
  CLOSED_ACCOUNT_MESSAGE,
  FROZEN_PROFILE_MESSAGE,
} from "../../src/utils/userFacingError";
import { resolveEdgeFunctionError } from "../../src/utils/edgeFunctionError";
import { transactionTitle } from "../../src/utils/transactionLabels";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

function httpError(payload: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: {
      json: async () => payload,
      clone() {
        return this;
      },
    },
  };
}

describe("frozen-send messages (toUserFacingError)", () => {
  it("maps the old raw RPC refusal to the crafted frozen message with a remedy", () => {
    expect(toUserFacingError(new Error("Source account is frozen and cannot send"))).toBe(
      FROZEN_SUB_ACCOUNT_MESSAGE,
    );
    expect(FROZEN_SUB_ACCOUNT_MESSAGE).toContain("frozen");
    expect(FROZEN_SUB_ACCOUNT_MESSAGE).toContain("unfreeze");
  });

  it("maps the new RPC wording to the same canonical message", () => {
    expect(
      toUserFacingError(
        new Error("This account is frozen, so money can't be sent from it right now. It can still receive money - unfreeze it to send again."),
      ),
    ).toBe(FROZEN_SUB_ACCOUNT_MESSAGE);
  });

  it("passes the server's crafted profile-freeze message through unchanged", () => {
    expect(toUserFacingError(new Error(FROZEN_PROFILE_MESSAGE))).toBe(FROZEN_PROFILE_MESSAGE);
  });

  it("maps closed-account refusals to the closed message", () => {
    expect(toUserFacingError(new Error("Source account is closed and cannot send"))).toBe(
      CLOSED_ACCOUNT_MESSAGE,
    );
    expect(toUserFacingError(new Error("Destination account is closed"))).toBe(CLOSED_ACCOUNT_MESSAGE);
  });

  it("does not hijack unrelated frozen wording (escrow, cards)", () => {
    expect(toUserFacingError(new Error("The escrow is frozen while the dispute is resolved."))).toBe(
      "The escrow is frozen while the dispute is resolved.",
    );
  });
});

describe("frozen-send body extraction (resolveEdgeFunctionError)", () => {
  it("surfaces the frozen refusal from the function body, not the generic invoke text", async () => {
    const error = httpError({ error: FROZEN_PROFILE_MESSAGE });
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe(
      FROZEN_PROFILE_MESSAGE,
    );
  });

  it("surfaces a sub-account frozen refusal from the body as the canonical message", async () => {
    const error = httpError({ error: "Source account is frozen and cannot send" });
    await expect(resolveEdgeFunctionError(error, "Transfer failed")).resolves.toBe(
      FROZEN_SUB_ACCOUNT_MESSAGE,
    );
  });
});

describe("send-path wiring: no caller discards the function body", () => {
  const fixedCallers = [
    "../../src/pages/SendMoney.tsx",
    "../../src/components/TransferForm.tsx",
    "../../src/pages/QrPayments.tsx",
    "../../src/hooks/useBillPayments.ts",
    "../../src/hooks/useBnpl.ts",
    "../../src/hooks/useBulkPayments.ts",
    "../../src/hooks/useEscrow.ts",
    "../../src/hooks/useRefunds.ts",
    "../../src/components/payments/CardPayment.tsx",
    // MobileMoneyPayment.tsx is NOT in this list any more: the
    // component was neutralised (provider-connections audit
    // 2026-10-26) into an honest "not available yet" panel that
    // makes NO edge-function call at all — there is no function
    // body left for it to discard. Its surface is pinned in
    // tests/payments/mobileMoneyCopyHonesty.test.ts.
    "../../src/components/payments/UssdPayment.tsx",
    "../../src/hooks/usePaymentProcessing.ts",
  ];
  for (const rel of fixedCallers) {
    it(`${rel.split("/").pop()} extracts the real error via resolveEdgeFunctionError`, () => {
      const src = read(rel);
      expect(src).toContain("resolveEdgeFunctionError");
      expect(src).not.toMatch(/throw new Error\((transferError|transferErr|error)\?*\.message/);
    });
  }
});

describe("SubAccounts frozen guard", () => {
  const src = read("../../src/pages/SubAccounts.tsx");
  it("shows the crafted frozen message instead of opening the transfer dialog", () => {
    expect(src).toContain("FROZEN_SUB_ACCOUNT_MESSAGE");
    expect(src).toContain("toast.error(FROZEN_SUB_ACCOUNT_MESSAGE)");
    expect(src).toContain("status === 'frozen'");
  });
  it("re-checks the source account inside the transfer handler", () => {
    expect(src).toContain("sourceGroup?.account?.status === 'frozen'");
  });
});

describe("internal-transfer history labels", () => {
  it("labels both sides with the actual account names the RPC now writes", () => {
    expect(
      transactionTitle({ direction: "incoming", category: "internal_transfer", description: "Transfer from Main account", recipient_name: null }),
    ).toBe("Transfer from Main account");
    expect(
      transactionTitle({ direction: "outgoing", category: "internal_transfer", description: "Transfer to Shop Takings", recipient_name: null }),
    ).toBe("Transfer to Shop Takings");
    expect(
      transactionTitle({ direction: "incoming", category: "internal_transfer", description: "Transfer from Shop Takings", recipient_name: null }),
    ).toBe("Transfer from Shop Takings");
  });

  it("TransactionManager no longer composes 'Unknown' labels", () => {
    const src = read("../../src/components/wallet/TransactionManager.tsx");
    expect(src).toContain("transactionTitle");
    expect(src).toContain("transactionCounterpartyLabel");
    expect(src).not.toContain('|| "Unknown"');
  });
});

describe("migration 20261214 (SQL source proof)", () => {
  const sql = read("../../supabase/migrations/20261214_internal_transfer_history_labels.sql");
  it("composes per-row account-named descriptions when no note is supplied", () => {
    expect(sql).toContain("'Transfer to ' || v_to_account_name");
    expect(sql).toContain("'Transfer from ' || v_from_account_name");
    expect(sql).toContain("'Main account'");
    expect(sql).toContain("v_in_description");
    expect(sql).toContain("v_out_description");
  });
  it("raises the crafted frozen refusal and drops the raw one", () => {
    expect(sql).toContain("This account is frozen, so money can");
    expect(sql).not.toContain("RAISE EXCEPTION 'Source account is % and cannot send'");
  });
  it("points each row's reference at the counterparty wallet", () => {
    expect(sql).toContain("'completed', v_in_description, 'internal:' || p_from_wallet_id::text");
    expect(sql).toContain("'completed', v_out_description, 'internal:' || p_to_wallet_id::text");
  });
});

describe("QuickActions dead buttons", () => {
  const src = read("../../src/components/wallet/QuickActions.tsx");
  it("QR Pay navigates to the live QR payments page (no 'coming soon' toast)", () => {
    expect(src).toContain('navigate("/qr-payments")');
    expect(src).not.toContain('toast("QR payment feature coming soon")');
  });
  it("Bills and Mobile navigate to bill payments, not back to /wallet", () => {
    expect(src).toContain('navigate("/bill-payments")');
  });
});
