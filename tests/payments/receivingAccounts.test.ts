// Local receiving accounts (virtual USD/EUR/GBP) — platform side,
// 2026-10-28 Payoneer-gap programme.
//
// Layers, mirroring the repo's existing suites:
//   1. The pure display module (src/utils/receivingAccounts.ts) —
//      the no-details-no-display invariant has exactly one gate
//      (receivingDetailFields), pinned behaviourally here.
//   2. The migration (20261246) at source level, the same
//      readFileSync approach as paypalPayout.test.ts: flag default,
//      GRANT rule compliance, RLS, RPC guards and the exactly-once
//      credit ordering (status check BEFORE any insert / balance
//      update).
//   3. Wiring pins: routes, role guard, RPC-only writes in the
//      service layer.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canUseReceivingAdmin,
  receivingRpcErrorMessage,
} from "../../supabase/functions/_shared/receiving-accounts";
import {
  RECEIVING_CURRENCIES,
  detailsMayBeShown,
  hasDisplayableDetails,
  isReceivingCurrency,
  receivingAccountStatusCopy,
  receivingDetailFields,
  receivingDepositStatusCopy,
  requestOutcomeMessage,
  type ReceivingAccount,
} from "../../src/utils/receivingAccounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const migration = read(
  "../../supabase/migrations/20261246_receiving_accounts.sql",
);
const userPage = read("../../src/pages/ReceivingAccounts.tsx");
const adminFn = read("../../supabase/functions/receiving-admin/index.ts");
const sharedModule = read(
  "../../supabase/functions/_shared/receiving-accounts.ts",
);
const adminPage = read("../../src/pages/AdminReceivingAccounts.tsx");
const service = read("../../src/services/receivingAccountsService.ts");
const routes = read("../../src/components/AnimatedRoutes.tsx");

const baseAccount: ReceivingAccount = {
  id: "acc-1",
  user_id: "user-1",
  partner_id: "partner-1",
  currency: "USD",
  status: "requested",
  account_holder_name: null,
  routing_number: null,
  account_number: null,
  iban: null,
  bic: null,
  sort_code: null,
  assigned_at: null,
  created_at: "2026-10-28T00:00:00Z",
};

describe("currency set", () => {
  it("is exactly USD, EUR, GBP", () => {
    expect(RECEIVING_CURRENCIES).toEqual(["USD", "EUR", "GBP"]);
    expect(isReceivingCurrency("USD")).toBe(true);
    expect(isReceivingCurrency("ZMW")).toBe(false);
    expect(isReceivingCurrency("usd")).toBe(false);
  });
});

describe("no-details-no-display invariant", () => {
  it("a requested account renders no detail fields, even with stray data", () => {
    const stray: ReceivingAccount = {
      ...baseAccount,
      status: "requested",
      account_holder_name: "Test Person",
      routing_number: "021000021",
      account_number: "123456789",
    };
    expect(detailsMayBeShown(stray)).toBe(false);
    expect(receivingDetailFields(stray)).toEqual([]);
    expect(hasDisplayableDetails(stray)).toBe(false);
  });

  it("pending_partner, suspended and closed accounts render nothing", () => {
    for (const status of ["pending_partner", "suspended", "closed"] as const) {
      const account: ReceivingAccount = {
        ...baseAccount,
        status,
        account_holder_name: "Test Person",
        routing_number: "021000021",
        account_number: "123456789",
      };
      expect(receivingDetailFields(account)).toEqual([]);
    }
  });

  it("an assigned USD account shows holder, routing and account number", () => {
    const account: ReceivingAccount = {
      ...baseAccount,
      status: "assigned",
      account_holder_name: "Test Person",
      routing_number: "021000021",
      account_number: "123456789",
    };
    const fields = receivingDetailFields(account);
    expect(fields.map((f) => f.label)).toEqual([
      "Account holder",
      "Routing number",
      "Account number",
    ]);
    expect(fields.map((f) => f.value)).toContain("021000021");
  });

  it("a partial record shows nothing rather than half an account", () => {
    const account: ReceivingAccount = {
      ...baseAccount,
      status: "active",
      account_holder_name: "Test Person",
      routing_number: "021000021",
      account_number: null,
    };
    expect(receivingDetailFields(account)).toEqual([]);
  });

  it("EUR needs the IBAN; BIC is optional garnish", () => {
    const withIban: ReceivingAccount = {
      ...baseAccount,
      currency: "EUR",
      status: "active",
      account_holder_name: "Test Person",
      iban: "DE89370400440532013000",
    };
    expect(
      receivingDetailFields(withIban).map((f) => f.label),
    ).toContain("IBAN");
    const noIban: ReceivingAccount = { ...withIban, iban: null, bic: "COBADEHDXXX" };
    expect(receivingDetailFields(noIban)).toEqual([]);
  });

  it("GBP needs sort code and account number", () => {
    const gbp: ReceivingAccount = {
      ...baseAccount,
      currency: "GBP",
      status: "active",
      account_holder_name: "Test Person",
      sort_code: "04-06-75",
      account_number: "12345678",
    };
    expect(receivingDetailFields(gbp).map((f) => f.label)).toEqual([
      "Account holder",
      "Sort code",
      "Account number",
    ]);
    expect(
      receivingDetailFields({ ...gbp, sort_code: null }),
    ).toEqual([]);
  });
});

describe("honest copy", () => {
  it("status copy never promises details by a date", () => {
    for (const status of [
      "requested",
      "pending_partner",
      "assigned",
      "active",
      "suspended",
      "closed",
    ] as const) {
      const copy = receivingAccountStatusCopy(status);
      expect(copy).not.toMatch(/\bby (monday|tuesday|tomorrow|\d)/i);
      expect(copy).not.toMatch(/within \d+ (day|hour)/i);
    }
    expect(receivingAccountStatusCopy("requested")).toMatch(/notify you/i);
  });

  it("deposit copy distinguishes recorded from credited", () => {
    expect(receivingDepositStatusCopy("recorded")).toMatch(/being credited/i);
    expect(receivingDepositStatusCopy("credited")).toMatch(/credited/i);
  });

  it("request outcomes map to crafted messages", () => {
    expect(requestOutcomeMessage("kyc_required")).toMatch(/verify your identity/i);
    expect(requestOutcomeMessage("feature_not_enabled")).toMatch(/being set up/i);
    expect(requestOutcomeMessage("something_unknown")).toMatch(/try again/i);
  });
});

describe("receiving-admin shared gate", () => {
  it("admin and super_admin pass; plain users do not", () => {
    expect(canUseReceivingAdmin(["user", "admin"])).toBe(true);
    expect(canUseReceivingAdmin(["super_admin"])).toBe(true);
    expect(canUseReceivingAdmin(["user"])).toBe(false);
    expect(canUseReceivingAdmin([])).toBe(false);
  });

  it("crafted RPC messages pass through; raw provider text collapses", () => {
    expect(
      receivingRpcErrorMessage({
        message: "Only an admin can credit a receiving deposit",
      }),
    ).toContain("Only an admin");
    expect(
      receivingRpcErrorMessage({
        message: "PGRST300: relation \"x\" does not exist",
      }),
    ).toMatch(/try again/i);
    expect(receivingRpcErrorMessage(null)).toMatch(/try again/i);
  });
});

describe("migration 20261246 — flag, grants, RLS", () => {
  it("adds the kill switch defaulting to false", () => {
    expect(migration).toContain(
      "receiving_accounts_enabled boolean NOT NULL DEFAULT false",
    );
  });

  it("creates the three tables with RLS enabled and scoped grants", () => {
    for (const table of [
      "receiving_partners",
      "receiving_accounts",
      "receiving_deposits",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
      expect(migration).toContain(`GRANT SELECT ON public.${table} TO authenticated`);
    }
    // CEO GRANT rule (2026-10-28): never GRANT ... TO public.
    expect(migration).not.toMatch(/grant[^;]*\bto\s+public\b/i);
    // No client write grants on the new tables.
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)/i);
  });

  it("revokes RPC execute from public and anon, grants authenticated", () => {
    for (const fn of [
      "request_receiving_account",
      "admin_create_receiving_partner",
      "admin_update_receiving_partner",
      "admin_assign_receiving_account",
      "admin_set_receiving_account_status",
      "admin_record_receiving_deposit",
      "admin_credit_receiving_deposit",
      "admin_reject_receiving_deposit",
    ]) {
      expect(migration).toContain(fn);
    }
    const revokes = migration.match(/REVOKE EXECUTE ON FUNCTION/g) ?? [];
    expect(revokes.length).toBeGreaterThanOrEqual(9);
    expect(migration).toMatch(/FROM PUBLIC, anon/);
  });
});

describe("migration 20261246 — RPC guards", () => {
  it("request path checks flag, then KYC, then inserts", () => {
    const flagAt = migration.indexOf("feature_not_enabled");
    const kycAt = migration.indexOf("kyc_required");
    const insertAt = migration.indexOf(
      "INSERT INTO public.receiving_accounts (user_id, currency, status)",
    );
    expect(flagAt).toBeGreaterThan(-1);
    expect(kycAt).toBeGreaterThan(flagAt);
    expect(insertAt).toBeGreaterThan(kycAt);
    expect(migration).toContain("kv.verified_at IS NOT NULL");
  });

  it("assignment refuses a partner that is not live", () => {
    const assignAt = migration.indexOf("admin_assign_receiving_account");
    const liveCheck = migration.indexOf("v_partner.status <> 'live'", assignAt);
    expect(liveCheck).toBeGreaterThan(assignAt);
    expect(migration).toContain("does not issue accounts in that currency");
  });

  it("every admin RPC re-checks the actor's role and writes an audit row", () => {
    const adminChecks =
      migration.match(/has_role\(p_actor_id, 'admin'::app_role\)/g) ?? [];
    expect(adminChecks.length).toBeGreaterThanOrEqual(7);
    const audits =
      migration.match(/INSERT INTO public\.audit_logs/g) ?? [];
    expect(audits.length).toBeGreaterThanOrEqual(7);
  });

  it("admin RPCs are service_role-only (edge function is the only caller)", () => {
    for (const fn of [
      "admin_create_receiving_partner",
      "admin_update_receiving_partner",
      "admin_assign_receiving_account",
      "admin_set_receiving_account_status",
      "admin_record_receiving_deposit",
      "admin_credit_receiving_deposit",
      "admin_reject_receiving_deposit",
    ]) {
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(UUID,`),
      );
    }
    expect(migration).toContain("TO service_role;");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated;");
    // The one client-callable RPC (no money movement) stays authenticated.
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.request_receiving_account(TEXT) TO authenticated;",
    );
  });

  it("credit is exactly-once: row lock + already_credited BEFORE any insert", () => {
    const creditAt = migration.indexOf("admin_credit_receiving_deposit");
    const lockAt = migration.indexOf("FOR UPDATE", creditAt);
    const alreadyAt = migration.indexOf("'already_credited'", creditAt);
    const insertAt = migration.indexOf(
      "INSERT INTO public.transactions",
      creditAt,
    );
    const balanceAt = migration.indexOf(
      "SET balance = balance + v_deposit.amount",
      creditAt,
    );
    expect(lockAt).toBeGreaterThan(creditAt);
    expect(alreadyAt).toBeGreaterThan(lockAt);
    expect(insertAt).toBeGreaterThan(alreadyAt);
    expect(balanceAt).toBeGreaterThan(insertAt);
    expect(migration).toContain("'receiving-deposit:' || v_deposit.id::text");
    // Wallet find-or-create is inside the credit, advisory-locked.
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("INSERT INTO public.wallets");
  });

  it("deposit recording requires issued details on the account", () => {
    expect(migration).toContain(
      "Payments can only be recorded against an account with issued details",
    );
    expect(migration).toContain("v_account.status NOT IN ('assigned', 'active')");
  });
});

describe("wiring", () => {
  it("routes exist; the admin route is role-guarded", () => {
    expect(routes).toContain('path="/receiving-accounts"');
    expect(routes).toContain('path="/admin/receiving-accounts"');
    expect(routes).toMatch(
      /admin\/receiving-accounts[\s\S]{0,200}roles=\{\['admin', 'super_admin'\]\}/,
    );
  });

  it("the user page renders details only through the single gate", () => {
    expect(userPage).toContain("receivingDetailFields(account)");
    expect(userPage).toContain("hasDisplayableDetails(account)");
    // The page itself must not print raw detail columns anywhere else.
    expect(userPage).not.toMatch(/account\.iban|account\.routing_number|account\.sort_code/);
    expect(userPage).toContain("RECEIVING_FEATURE_OFF_COPY");
  });

  it("the service writes only through the request RPC + admin edge function", () => {
    expect(service).toContain('rpc("request_receiving_account"');
    expect(service).toContain('functions.invoke("receiving-admin"');
    expect(service).not.toContain("admin_credit_receiving_deposit");
    expect(service).not.toContain(".insert(");
    expect(service).not.toContain(".update(");
    expect(service).not.toContain(".delete(");
  });

  it("the edge function gates auth -> role -> JWT-free RPC with actor id", () => {
    expect(adminFn).toContain("getServiceRoleClient()");
    const authAt = adminFn.indexOf("supabase.auth.getUser(token)");
    const gateAt = adminFn.indexOf(
      "await canUseReceivingAdminFor(supabase, user.id)",
    );
    const rpcAt = adminFn.indexOf("supabase.rpc(rpcName, rpcArgs)");
    expect(authAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(authAt);
    expect(rpcAt).toBeGreaterThan(gateAt);
    expect(adminFn).toContain("p_actor_id: user.id");
    expect(sharedModule).toContain("protect_wallet_balance");
  });

  it("the admin page offers no assignment without a live partner concept", () => {
    expect(adminPage).toContain('p.status === "live"');
    expect(adminPage).toContain("No live partner yet");
  });
});
