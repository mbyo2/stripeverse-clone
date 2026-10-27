// Unit tests for supabase/functions/_shared/telco-payments.ts (the
// mobile-money function's shared telco contract) plus source-level
// pins for the telco ledger migration 20261237 and the mobile-money
// function's wiring of it.
//
// The money properties under test:
//   - Initiation REQUIRES a caller idempotency key (a retry without
//     one must never be able to mint a second payment).
//   - Provider/action aliases normalise to exactly one rail + one
//     action; Zamtel stays routable to its truthful refusal.
//   - The ledger RPCs exist with service_role-only ACLs, the Airtel
//     kill switch defaults OFF, and settlement is a SECURITY DEFINER
//     function that verifies amount + currency before moving money.
//   - The edge function settles ONLY through the settle RPC and
//     treats callbacks through the hint RPC (never the body).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeTelcoAction,
  normalizeTelcoProvider,
  telcoApiStatus,
  telcoBeginOutcomeMessage,
  telcoPaymentResponse,
  telcoProviderFailureMessage,
  validateTelcoIdempotencyKey,
  TELCO_IDEMPOTENCY_REQUIRED_MESSAGE,
} from "../../supabase/functions/_shared/telco-payments";

const migration = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261237_airtel_money_and_telco_ledger.sql"),
  "utf8",
);
const mobileMoneyFn = readFileSync(
  resolve(__dirname, "../../supabase/functions/mobile-money/index.ts"),
  "utf8",
);
const callbackFn = readFileSync(
  resolve(__dirname, "../../supabase/functions/mobile-money-callback/index.ts"),
  "utf8",
);
const configToml = readFileSync(
  resolve(__dirname, "../../supabase/config.toml"),
  "utf8",
);

describe("provider / action normalisation", () => {
  it("maps aliases to exactly one rail", () => {
    expect(normalizeTelcoProvider("mtn")).toBe("mtn");
    expect(normalizeTelcoProvider("MTN_MOMO")).toBe("mtn");
    expect(normalizeTelcoProvider("airtel_money")).toBe("airtel");
    expect(normalizeTelcoProvider("Airtel Money")).toBe("airtel");
    expect(normalizeTelcoProvider("zamtel")).toBe("zamtel");
    expect(normalizeTelcoProvider("mobile_money")).toBeNull();
    expect(normalizeTelcoProvider("paypal")).toBeNull();
    expect(normalizeTelcoProvider(42)).toBeNull();
  });

  it("maps action aliases and rejects unknown actions", () => {
    expect(normalizeTelcoAction("request-to-pay")).toBe("collection");
    expect(normalizeTelcoAction("collection-status")).toBe("collection-status");
    expect(normalizeTelcoAction("withdraw")).toBe("disbursement");
    expect(normalizeTelcoAction("disbursement_status")).toBe("disbursement-status");
    expect(normalizeTelcoAction("balance")).toBe("balance");
    expect(normalizeTelcoAction("account-holder")).toBe("account-holder");
    expect(normalizeTelcoAction("callback")).toBe("callback");
    expect(normalizeTelcoAction("refund")).toBeNull();
    expect(normalizeTelcoAction(undefined)).toBeNull();
  });
});

describe("idempotency discipline", () => {
  it("requires an 8–128 char conservative key", () => {
    expect(validateTelcoIdempotencyKey("checkout-123")).toBe("checkout-123");
    expect(validateTelcoIdempotencyKey("short")).toBeNull();
    expect(validateTelcoIdempotencyKey("has spaces in it")).toBeNull();
    expect(validateTelcoIdempotencyKey("x".repeat(129))).toBeNull();
    expect(validateTelcoIdempotencyKey(undefined)).toBeNull();
    expect(TELCO_IDEMPOTENCY_REQUIRED_MESSAGE).toContain("unique request reference");
  });
});

describe("response shaping", () => {
  it("maps ledger status to API status and never calls pending a success", () => {
    expect(telcoApiStatus("successful")).toBe("completed");
    expect(telcoApiStatus("pending")).toBe("pending");
    expect(telcoApiStatus("failed")).toBe("failed");
    const pending = telcoPaymentResponse({
      provider: "mtn", product: "collection", status: "pending",
      transactionId: "txn-1", reference: "ref-1",
    });
    expect(pending.success).toBe(false);
    expect(pending.status).toBe("pending");
    const done = telcoPaymentResponse({
      provider: "airtel", product: "disbursement", status: "successful",
      transactionId: "txn-2", reference: "ref-2",
    });
    expect(done.success).toBe(true);
    expect(done.status).toBe("completed");
    const failed = telcoPaymentResponse({
      provider: "mtn", product: "disbursement", status: "failed",
      transactionId: "txn-3", reference: "ref-3",
    });
    expect(failed.message).toContain("returned to your wallet");
  });

  it("begin outcomes and provider failures are plain language, never raw", () => {
    expect(telcoBeginOutcomeMessage("insufficient_funds")).toContain("No money has moved");
    expect(telcoBeginOutcomeMessage("idempotency_conflict")).toContain("already used");
    expect(telcoProviderFailureMessage("mtn", "validation")).toContain("MTN MoMo");
    expect(telcoProviderFailureMessage("airtel", "auth")).toContain("No money has moved");
  });
});

describe("migration 20261237 — telco ledger", () => {
  it("adds the Airtel kill switch default OFF, same pattern as MTN", () => {
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS airtel_money_enabled boolean NOT NULL DEFAULT false",
    );
  });

  it("creates the provider-neutral ledger table with a unique provider reference", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.mobile_money_payments");
    expect(migration).toContain("provider_reference TEXT NOT NULL UNIQUE");
    expect(migration).toContain("idempotency_key TEXT NOT NULL UNIQUE");
    expect(migration).toContain("provider IN ('mtn', 'airtel')");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("defines the four ledger RPCs as SECURITY DEFINER", () => {
    for (const fn of [
      "begin_mobile_money_payment",
      "update_mobile_money_submission",
      "record_mobile_money_callback_hint",
      "settle_mobile_money_payment",
    ]) {
      expect(migration).toContain(`FUNCTION public.${fn}`);
    }
    expect(migration.match(/SECURITY DEFINER/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("settlement verifies amount and currency before moving money", () => {
    expect(migration).toContain("amount_mismatch");
    expect(migration).toContain("currency_mismatch");
    expect(migration).toContain("terminal_conflict");
  });

  it("a disbursement refund is possible only from the debited state (exactly once)", () => {
    expect(migration).toContain("wallet_effect = 'debited'");
    expect(migration).toContain("'refunded'");
  });

  it("RPCs are service_role only", () => {
    expect(migration).toContain("FROM PUBLIC, authenticated, anon");
    expect(migration).toContain("TO service_role");
  });

  it("the callback hint RPC changes no payment status", () => {
    const hintFn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.record_mobile_money_callback_hint"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.settle_mobile_money_payment"),
    );
    expect(hintFn).toContain("callback_count = callback_count + 1");
    expect(hintFn).not.toContain("balance = balance");
  });
});

describe("mobile-money function wiring", () => {
  it("begins ledger-first and settles through the RPCs", () => {
    expect(mobileMoneyFn).toContain('"begin_mobile_money_payment"');
    expect(mobileMoneyFn).toContain('"settle_mobile_money_payment"');
    expect(mobileMoneyFn).toContain('"record_mobile_money_callback_hint"');
    expect(mobileMoneyFn).toContain('"update_mobile_money_submission"');
  });

  it("dispatches the wired actions for both rails", () => {
    expect(mobileMoneyFn).toContain("initiateTelcoPayment");
    expect(mobileMoneyFn).toContain("telcoStatusAction");
    expect(mobileMoneyFn).toContain("telcoBalanceAction");
    expect(mobileMoneyFn).toContain("telcoAccountHolderAction");
    expect(mobileMoneyFn).toContain("handleTelcoCallback");
  });

  it("reads the exact secret names from the onboarding packs", () => {
    for (const name of [
      "MTN_MOMO_ENV",
      "MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY",
      "MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY",
      "MTN_MOMO_API_USER_ID",
      "MTN_MOMO_API_KEY",
      "MTN_MOMO_TARGET_ENVIRONMENT",
      "MTN_MOMO_CALLBACK_URL",
      "MTN_MOMO_PRODUCTION_BASE_URL",
      "AIRTEL_ENV",
      "AIRTEL_CLIENT_ID",
      "AIRTEL_CLIENT_SECRET",
      "AIRTEL_PUBLIC_KEY_PEM",
      "AIRTEL_CALLBACK_URL",
      "AIRTEL_API_SHAPES_CONFIRMED",
    ]) {
      expect(mobileMoneyFn).toContain(`Deno.env.get("${name}")`);
    }
  });

  it("Zamtel still answers through the truthful not-configured route", () => {
    expect(mobileMoneyFn).toContain('if (provider === "zamtel") return notConfigured("zamtel");');
  });
});

describe("mobile-money-callback function (public hint receiver)", () => {
  it("is verify_jwt=false while mobile-money keeps verify_jwt=true", () => {
    expect(configToml).toContain("[functions.mobile-money-callback]\nverify_jwt = false");
    expect(configToml).toContain("[functions.mobile-money]\nverify_jwt = true");
  });

  it("identifies via the hint RPC and settles only after a status re-query", () => {
    expect(callbackFn).toContain('"record_mobile_money_callback_hint"');
    expect(callbackFn).toContain('"settle_mobile_money_payment"');
    expect(callbackFn).toContain("client.getStatus(");
    // The settle call consumes the RE-QUERIED status object, never
    // a status field read from the callback body.
    const settleAt = callbackFn.indexOf('"settle_mobile_money_payment"');
    const requeryAt = callbackFn.indexOf("client.getStatus(");
    expect(requeryAt).toBeGreaterThan(-1);
    expect(requeryAt).toBeLessThan(settleAt);
    expect(callbackFn).toContain("p_provider_status: parsed.status");
  });

  it("always answers 200 shapes (received) rather than erroring providers", () => {
    expect(callbackFn).toContain("json({ received: true, identified: false })");
    expect(callbackFn).toContain("json({ received: true, identified: true })");
  });
});
