// Unit tests for supabase/functions/_shared/mastercard-processing.ts
// plus source pins for the mastercard-processing edge function, the
// provider branch inside create-virtual-card, and migration
// 20261107.
//
// The properties under test are the honesty ones:
//   * Sandbox defaults are the DOCUMENTED test values (brief §1.1)
//     and resolve ONLY in sandbox — production without onboarding
//     values is not configured, never silently defaulted.
//   * Request bodies match the official sandbox test-case shapes
//     (POST /clients → /accounts → /cards).
//   * Provider failures classify truthfully (a 403 is a
//     provisioning refusal, not a generic error) and crafted
//     messages never echo provider prose.
//   * PAN hygiene — masking matches the mask_card_number RPC shape
//     and the deep redactor scrubs every secret-shaped field.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROCESSING_ADMIN_REFUSAL_MESSAGE,
  PROCESSING_NOT_CONFIGURED_MESSAGE,
  SANDBOX_ACCOUNT_PRODUCT_CODE,
  SANDBOX_CARD_PRODUCT_CODE,
  SANDBOX_CLIENT_TYPE,
  accountContractIdFrom,
  accountsUrl,
  buildCreateAccountBody,
  buildCreateCardBody,
  buildCreateClientBody,
  cardContractIdFrom,
  cardContractUrl,
  cardContractStatusUrl,
  cardExpiryFrom,
  cardNumberFrom,
  cardsUrl,
  classifyProviderRefusal,
  clientIdFrom,
  clientsUrl,
  contractTransactionsUrl,
  craftedProcessingError,
  deriveAccountContractNumber,
  deriveClientNumber,
  expiryDateFromYymm,
  expiryDisplayFromYymm,
  hasProcessingAdmin,
  idFromLocationHeader,
  isProcessingAdminRole,
  isProcessingConfigured,
  maskPan,
  normaliseCardStatus,
  normaliseTransactions,
  processingBaseUrl,
  providerReasonCode,
  redactPanInText,
  redactSensitive,
  resolveAccountProductCode,
  resolveCardProductCode,
  resolveClientType,
  type MastercardProcessingConfig,
} from "../../supabase/functions/_shared/mastercard-processing";

const sandboxConfig: MastercardProcessingConfig = {
  env: "sandbox",
  consumerKey: "ck",
  signingKeyPem: "pem",
  clientType: null,
  accountProductCode: null,
  cardProductCode: null,
};
const prodConfig: MastercardProcessingConfig = { ...sandboxConfig, env: "production" };

describe("provider URLs (official API reference environment domains)", () => {
  it("uses the sandbox global-processing base in sandbox", () => {
    expect(processingBaseUrl(sandboxConfig)).toBe(
      "https://sandbox.api.mastercard.com/global-processing/core",
    );
    expect(clientsUrl(sandboxConfig)).toBe(
      "https://sandbox.api.mastercard.com/global-processing/core/clients",
    );
    expect(accountsUrl(sandboxConfig)).toBe(
      "https://sandbox.api.mastercard.com/global-processing/core/accounts",
    );
    expect(cardsUrl(sandboxConfig)).toBe(
      "https://sandbox.api.mastercard.com/global-processing/core/cards",
    );
  });
  it("uses the production base in production", () => {
    expect(cardContractUrl(prodConfig, "70001")).toBe(
      "https://api.mastercard.com/global-processing/core/cards/70001",
    );
    expect(cardContractStatusUrl(prodConfig, "70001")).toBe(
      "https://api.mastercard.com/global-processing/core/cards/70001/status",
    );
    expect(contractTransactionsUrl(prodConfig, "70001")).toBe(
      "https://api.mastercard.com/global-processing/core/contracts/70001/transactions",
    );
  });
  it("URL-encodes contract ids", () => {
    expect(cardContractUrl(sandboxConfig, "a/b")).toContain("/cards/a%2Fb");
  });
});

describe("configuration resolution (brief §1.1)", () => {
  it("resolves the documented sandbox test values in sandbox", () => {
    expect(resolveClientType(sandboxConfig)).toBe(SANDBOX_CLIENT_TYPE);
    expect(SANDBOX_CLIENT_TYPE).toBe("PR");
    expect(resolveAccountProductCode(sandboxConfig)).toBe("STD-DEBCH-EUR");
    expect(resolveCardProductCode(sandboxConfig)).toBe("STD-MCDEBVF-EUR");
    expect(isProcessingConfigured(sandboxConfig)).toBe(true);
  });
  it("explicit onboarding values win over sandbox defaults", () => {
    const cfg = { ...sandboxConfig, clientType: "AGREED", accountProductCode: "ACC-X", cardProductCode: "CARD-X" };
    expect(resolveClientType(cfg)).toBe("AGREED");
    expect(resolveAccountProductCode(cfg)).toBe("ACC-X");
    expect(resolveCardProductCode(cfg)).toBe("CARD-X");
  });
  it("production has NO defaults — unconfigured until onboarding supplies them", () => {
    expect(resolveClientType(prodConfig)).toBeNull();
    expect(resolveAccountProductCode(prodConfig)).toBeNull();
    expect(resolveCardProductCode(prodConfig)).toBeNull();
    expect(isProcessingConfigured(prodConfig)).toBe(false);
    const onboarded = { ...prodConfig, clientType: "PR2", accountProductCode: "A", cardProductCode: "C" };
    expect(isProcessingConfigured(onboarded)).toBe(true);
  });
  it("is not configured without the OAuth pair", () => {
    expect(isProcessingConfigured({ ...sandboxConfig, consumerKey: null })).toBe(false);
    expect(isProcessingConfigured({ ...sandboxConfig, signingKeyPem: null })).toBe(false);
  });
});

describe("admin gate", () => {
  it("admits admin and super_admin only", () => {
    expect(isProcessingAdminRole("admin")).toBe(true);
    expect(isProcessingAdminRole("super_admin")).toBe(true);
    for (const role of ["user", "business", "beta_tester", "p2p_admin", "", null, undefined]) {
      expect(isProcessingAdminRole(role)).toBe(false);
    }
    expect(hasProcessingAdmin(["user", "admin"])).toBe(true);
    expect(hasProcessingAdmin(["user"])).toBe(false);
    expect(hasProcessingAdmin([])).toBe(false);
  });
  it("refusal copy matches the platform's coming-soon posture", () => {
    expect(PROCESSING_ADMIN_REFUSAL_MESSAGE).toContain("coming soon");
    expect(PROCESSING_NOT_CONFIGURED_MESSAGE).toContain("not configured");
  });
});

describe("our-side identifiers", () => {
  it("derives a stable client number per user", () => {
    const a = deriveClientNumber("f9cf338f-dc77-403b-b2ec-e609951c8440");
    expect(a).toBe("BMG-F9CF338FDC77403BB2ECE609951C8440");
    expect(deriveClientNumber("f9cf338f-dc77-403b-b2ec-e609951c8440")).toBe(a);
    expect(deriveClientNumber("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).not.toBe(a);
  });
  it("derives account contract numbers from the seed", () => {
    expect(deriveAccountContractNumber("12345678-1234-1234-1234-123456789012"))
      .toBe("BMG-A-123456781234123412341234");
  });
});

describe("request bodies (official sandbox test-case shapes)", () => {
  it("create client carries clientNumber, clientType, personal + embossed data", () => {
    const body = buildCreateClientBody({
      clientNumber: "BMG-ABC",
      clientType: "PR",
      firstName: "John",
      lastName: "Doe",
    });
    expect(body.clientNumber).toBe("BMG-ABC");
    expect(body.clientType).toBe("PR");
    expect(body.clientPersonalData).toEqual({ firstName: "John", lastName: "Doe" });
    expect(body.embossedData).toEqual({ firstName: "JOHN", lastName: "DOE" });
    expect(body.clientContactData).toBeUndefined();
  });
  it("create client includes contact data only when provided", () => {
    const body = buildCreateClientBody({
      clientNumber: "BMG-ABC",
      clientType: "PR",
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phoneNumberMobile: "0048123456789",
    });
    expect(body.clientContactData).toEqual({
      email: "john@example.com",
      phoneNumberMobile: "0048123456789",
    });
  });
  it("create account nests the data and sends numeric client ids as numbers", () => {
    const body = buildCreateAccountBody({
      accountContractNumber: "BMG-A-1",
      clientId: "40000",
      productCode: "STD-DEBCH-EUR",
      currency: "eur",
    });
    expect(body).toEqual({
      accountContractData: {
        accountContractNumber: "BMG-A-1",
        clientId: 40000,
        productCode: "STD-DEBCH-EUR",
        currency: "EUR",
      },
    });
  });
  it("create card matches the test-case shape (ids + nested cardContract)", () => {
    const body = buildCreateCardBody({
      accountContractId: "60001",
      clientId: "40000",
      productCode: "STD-MCDEBVF-EUR",
      currency: "EUR",
      firstName: "John",
      lastName: "Doe",
    });
    expect(body.accountContractId).toBe(60001);
    expect(body.clientId).toBe(40000);
    expect(body.cardContract).toEqual({
      productCode: "STD-MCDEBVF-EUR",
      currency: "EUR",
      embossedData: { firstName: "JOHN", lastName: "DOE" },
    });
  });
});

describe("response extraction", () => {
  it("reads creation ids as strings from numeric or string payloads", () => {
    expect(clientIdFrom({ clientId: 40000 })).toBe("40000");
    expect(accountContractIdFrom({ accountContractId: 60001 })).toBe("60001");
    expect(cardContractIdFrom({ cardContractId: "70001" })).toBe("70001");
    expect(clientIdFrom({})).toBeNull();
    expect(clientIdFrom(null)).toBeNull();
  });
  it("falls back to the Location header", () => {
    expect(idFromLocationHeader("/clients/40000", "clients")).toBe("40000");
    expect(idFromLocationHeader("https://x/global-processing/core/cards/70001", "cards")).toBe("70001");
    expect(idFromLocationHeader("/accounts/1", "cards")).toBeNull();
    expect(idFromLocationHeader(null, "clients")).toBeNull();
  });
  it("reads the card number flat or nested, and the raw expiry", () => {
    expect(cardNumberFrom({ cardContractNumber: "5399111122223456" })).toBe("5399111122223456");
    expect(cardNumberFrom({ cardContract: { cardContractNumber: "5399111122223456" } }))
      .toBe("5399111122223456");
    expect(cardNumberFrom({ cardContractId: 70001 })).toBeNull();
    expect(cardExpiryFrom({ cardExpiryDate: "3004" })).toBe("3004");
    expect(cardExpiryFrom({ cardExpiryDate: "2030-04" })).toBeNull();
  });
});

describe("expiry conversions", () => {
  it("YYMM → last day of month ISO date", () => {
    expect(expiryDateFromYymm("3004")).toBe("2030-04-30");
    expect(expiryDateFromYymm("2802")).toBe("2028-02-29"); // leap year
    expect(expiryDateFromYymm("2702")).toBe("2027-02-28");
    expect(expiryDateFromYymm("3013")).toBeNull();
    expect(expiryDateFromYymm(null)).toBeNull();
    expect(expiryDateFromYymm("abcd")).toBeNull();
  });
  it("YYMM → MM/YY display", () => {
    expect(expiryDisplayFromYymm("3004")).toBe("04/30");
    expect(expiryDisplayFromYymm(null)).toBeNull();
  });
});

describe("card status normalisation", () => {
  it("maps CMS statuses onto the platform vocabulary", () => {
    expect(normaliseCardStatus("ACTIVE")).toBe("active");
    expect(normaliseCardStatus({ cardContractStatusData: { status: "BLOCKED" } })).toBe("frozen");
    expect(normaliseCardStatus({ status: "CLOSED" })).toBe("cancelled");
    expect(normaliseCardStatus({ baseCardContractStatusData: { code: "SUSPENDED" } })).toBe("frozen");
  });
  it("never guesses an unknown status into a state", () => {
    expect(normaliseCardStatus("SOMETHING_NEW")).toBe("unknown");
    expect(normaliseCardStatus(null)).toBe("unknown");
    expect(normaliseCardStatus({})).toBe("unknown");
  });
});

describe("transactions normalisation", () => {
  it("flattens the documented list shapes", () => {
    const txs = normaliseTransactions({
      transactions: [
        { transactionId: 1, transactionDate: "2026-10-01", amount: "25.50", currency: "EUR", description: "Shop", status: "POSTED" },
        { id: "t2", amount: 10, merchantName: "Cafe" },
      ],
    });
    expect(txs).toHaveLength(2);
    expect(txs[0]).toEqual({
      id: "1", date: "2026-10-01", amount: 25.5, currency: "EUR", description: "Shop", status: "POSTED",
    });
    expect(txs[1].description).toBe("Cafe");
    expect(txs[1].date).toBeNull();
  });
  it("is null-safe", () => {
    expect(normaliseTransactions(null)).toEqual([]);
    expect(normaliseTransactions({})).toEqual([]);
  });
});

// The CMS failure envelope from the official sandbox test cases.
const duplicatedPayload = {
  Errors: {
    Error: [{
      Source: "MASTERCARD PROCESSING",
      ReasonCode: "DUPLICATED_CLIENT_NUMBER",
      Description: "Duplicated client number.",
      Recoverable: false,
    }],
  },
};

describe("provider errors — truthful classification, crafted copy", () => {
  it("extracts the ReasonCode from the CMS envelope", () => {
    expect(providerReasonCode(duplicatedPayload)).toBe("DUPLICATED_CLIENT_NUMBER");
    expect(providerReasonCode({})).toBeNull();
    expect(providerReasonCode(null)).toBeNull();
  });
  it("classifies refusals by class", () => {
    expect(classifyProviderRefusal(401, null)).toBe("credentials_refused");
    expect(classifyProviderRefusal(403, null)).toBe("not_provisioned");
    expect(classifyProviderRefusal(404, null)).toBe("not_found");
    expect(classifyProviderRefusal(400, null)).toBe("validation");
    expect(classifyProviderRefusal(400, duplicatedPayload)).toBe("duplicate");
    expect(classifyProviderRefusal(500, null)).toBe("provider_error");
  });
  it("a 403 says provisioning, in plain language, with no provider prose", () => {
    const msg = craftedProcessingError(403, { note: "RAW-PROVIDER-PROSE" });
    expect(msg).toContain("not provisioned for this platform yet");
    expect(msg).not.toContain("RAW-PROVIDER-PROSE");
    const dup = craftedProcessingError(400, duplicatedPayload);
    expect(dup).toContain("already has a matching record");
    expect(dup).not.toContain("Duplicated client number.");
  });
});

describe("PAN hygiene", () => {
  it("maskPan matches the mask_card_number RPC shape", () => {
    expect(maskPan("5399111122223456")).toBe("**** **** **** 3456");
    expect(maskPan("5399 1111 2222 3456")).toBe("**** **** **** 3456");
    expect(maskPan(null)).toBeNull();
    expect(maskPan("12")).toBeNull();
  });
  it("redactPanInText masks long digit runs only", () => {
    expect(redactPanInText("card 5399111122223456 ok")).toBe("card ****3456 ok");
    expect(redactPanInText("order 12345")).toBe("order 12345");
  });
  it("redactSensitive scrubs secret fields deeply without mutating the original", () => {
    const payload = {
      cardContractId: 70001,
      cardContractNumber: "5399111122223456",
      nested: { cvv: "123", note: "paid with 5399111122223456" },
      list: [{ pin: "9999" }],
    };
    const safe = redactSensitive(payload) as Record<string, unknown>;
    expect(safe.cardContractNumber).toBe("**** **** **** 3456");
    expect((safe.nested as Record<string, unknown>).cvv).toBe("[redacted]");
    expect((safe.nested as Record<string, unknown>).note).toBe("paid with ****3456");
    expect(((safe.list as unknown[])[0] as Record<string, unknown>).pin).toBe("[redacted]");
    expect(safe.cardContractId).toBe(70001);
    expect(payload.cardContractNumber).toBe("5399111122223456");
  });
});

// Source pins: Deno code cannot run under vitest, so — the repo's
// established pattern — these pin the wiring that must not regress.
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const edgeFn = read("../../supabase/functions/mastercard-processing/index.ts");
const createCard = read("../../supabase/functions/create-virtual-card/index.ts");
const config = read("../../supabase/config.toml");
const migration = read("../../supabase/migrations/20261107_mc_processing_refs.sql");

describe("mastercard-processing edge function — source pins", () => {
  it("enforces the admin gate before the config check and any provider work", () => {
    const gateIdx = edgeFn.indexOf("hasProcessingAdmin(roles)");
    const configIdx = edgeFn.indexOf("isProcessingConfigured(config)");
    const callIdx = edgeFn.indexOf('providerCall(config, "POST", clientsUrl(config)');
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(configIdx).toBeGreaterThan(gateIdx);
    expect(callIdx).toBeGreaterThan(configIdx);
    expect(edgeFn).toContain("json(403,");
  });
  it("exposes exactly the five provider actions", () => {
    for (const action of ["create_client", "create_account", "issue_card", "card_status", "card_transactions"]) {
      expect(edgeFn).toContain(`action === "${action}"`);
    }
  });
  it("surfaces provider refusals truthfully — crafted error + class, never a fake success", () => {
    expect(edgeFn).toContain("craftedProcessingError(result.httpStatus, result.payload)");
    expect(edgeFn).toContain("refusal_class: classifyProviderRefusal(");
    expect(edgeFn).toContain("reason_code: providerReasonCode(");
  });
  it("persists provider references onto the virtual_cards row on issue", () => {
    expect(edgeFn).toContain("provider_client_id: clientId");
    expect(edgeFn).toContain("provider_account_id: accountId");
    expect(edgeFn).toContain("provider_card_id: cardId");
    expect(edgeFn).toContain('.from("virtual_cards")');
  });
  it("logs only through the redactor and never hardcodes a secret", () => {
    expect(edgeFn).toContain("redactSensitive(details)");
    expect(edgeFn).toContain('Deno.env.get("MASTERCARD_SIGNING_KEY_PEM")');
    expect(edgeFn).not.toMatch(/MASTERCARD_CONSUMER_KEY\s*=\s*"/);
  });
  it("is registered verify_jwt = true", () => {
    expect(config).toContain("[functions.mastercard-processing]\nverify_jwt = true");
  });
});

describe("create-virtual-card provider branch — source pins", () => {
  it("routes mastercard issuance through Processing only when MASTERCARD_ENV is set", () => {
    const branchIdx = createCard.indexOf('Deno.env.get("MASTERCARD_ENV") && schema.provider === "mastercard"');
    const localIdx = createCard.indexOf("rpc('generate_card_number')");
    expect(branchIdx).toBeGreaterThanOrEqual(0);
    expect(localIdx).toBeGreaterThan(branchIdx);
    expect(createCard).toContain("createCardViaProcessing({");
  });
  it("labels issuance honestly in both paths", () => {
    expect(createCard).toContain('issuance: "mastercard_processing"');
    expect(createCard).toContain('issuance: "local"');
  });
  it("stores provider references and claims no provider CVV", () => {
    expect(createCard).toContain("provider_client_id: providerClientId");
    expect(createCard).toContain("provider_account_id: providerAccountId");
    expect(createCard).toContain("provider_card_id: providerCardId");
    expect(createCard).toContain("cvv: null");
  });
  it("reuses the cardholder's existing CMS client instead of minting a duplicate", () => {
    expect(createCard).toContain('.not("provider_client_id", "is", null)');
    expect(createCard).toContain("deriveClientNumber(userId)");
  });
});

describe("20261107 migration — source pins", () => {
  it("adds exactly the three provider-reference columns, idempotently", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS provider_client_id TEXT");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS provider_account_id TEXT");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS provider_card_id TEXT");
  });
  it("changes no RLS — no policy statements at all", () => {
    expect(migration).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/);
    expect(migration).not.toMatch(/ENABLE ROW LEVEL|DISABLE ROW LEVEL/);
  });
});
