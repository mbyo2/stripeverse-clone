// Pins for the feature-visibility registry (CEO directive
// 2026-10-30: everything not completed or working stops being seen
// by regular users; only admin and super_admin keep full
// visibility). The registry in src/lib/featureVisibility.ts is the
// single source of truth every surface consults — these pins lock
// its contract:
//
//  1. For every flag-gated feature: hidden from a regular user
//     while its platform flag is off, visible the moment the flag
//     flips on — no second sweep needed.
//  2. For every flag-less (declared unfinished) feature: hidden
//     from regular users under EVERY flag combination.
//  3. Admin and super_admin see EVERYTHING under every flag
//     combination — the gate never applies to them.
//  4. Guests (no roles) see nothing gated.
//  5. Mobile-money providers resolve per provider flag; Zamtel has
//     no integration at all, so it is admin-tier only.
//  6. The self-custody MoonPay kill switch is NOT part of the
//     registry — self-custody buying is live and stays visible.
//  7. No working route is in the gated route map, and every gated
//     route is actually wrapped in FeatureRouteGate in
//     AnimatedRoutes (a hidden nav item with a live route is not
//     hidden).
//  8. The Wallet's data-stranding view exists and the withdraw
//     entry point routes non-admins with records to it.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEATURE_REGISTRY,
  FEATURE_ROUTE_MAP,
  WORKING_FEATURE_ROUTES,
  PLATFORM_FLAGS_ALL_OFF,
  isFeatureVisible,
  isMobileMoneyProviderVisible,
  visibleFeatures,
  type FeatureKey,
  type PlatformFeatureFlags,
} from "../../src/lib/featureVisibility";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(here, rel), "utf8");

const USER = ["user"];
const ADMIN = ["admin"];
const SUPER_ADMIN = ["super_admin"];
const GUEST: string[] = [];

const ALL_ON: PlatformFeatureFlags = {
  bank_payouts_enabled: true,
  paypal_payouts_enabled: true,
  receiving_accounts_enabled: true,
  moonpay_enabled: true,
  mtn_momo_enabled: true,
  airtel_money_enabled: true,
};
const ALL_OFF = PLATFORM_FLAGS_ALL_OFF;

const ALL_FEATURES = Object.keys(FEATURE_REGISTRY) as FeatureKey[];
const flagsOf = (f: FeatureKey): string[] => {
  const flag = FEATURE_REGISTRY[f].flag;
  if (!flag) return [];
  return Array.isArray(flag) ? [...flag] : [flag];
};
const FLAG_GATED = ALL_FEATURES.filter((f) => flagsOf(f).length > 0);
const FLAG_LESS = ALL_FEATURES.filter((f) => flagsOf(f).length === 0);

describe("registry shape", () => {
  it("covers every feature the 2026-10-30 inventory classified as hidden", () => {
    expect(ALL_FEATURES).toEqual(
      expect.arrayContaining([
        "bankWithdrawals",
        "paypalPayouts",
        "receivingAccounts",
        "custodialMoonpay",
        "mobileMoney",
        "virtualCards",
        "bankTransfers",
        "collectPayments",
        "ussdAccess",
        "billPayments",
        "agentNetwork",
        "cardVault",
        "cardProcessing",
        "payLater",
        "settlements",
        "cryptoPayouts",
        "legacyCheckout",
        "paymentMethods",
        "inactivePaymentSettings",
      ]),
    );
  });

  it("splits into flag-gated and flag-less features", () => {
    expect(FLAG_GATED).toEqual(
      expect.arrayContaining([
        "bankWithdrawals",
        "paypalPayouts",
        "receivingAccounts",
        "custodialMoonpay",
        "mobileMoney",
      ]),
    );
    expect(FLAG_LESS.length).toBeGreaterThan(0);
    expect(FLAG_GATED.length + FLAG_LESS.length).toBe(ALL_FEATURES.length);
  });

  it("never gates on the self-custody MoonPay kill switch (that rail is LIVE)", () => {
    const source = read("../../src/lib/featureVisibility.ts");
    // The flag is not part of the registry's flag set at all — it is
    // mentioned only in a note explaining why it is excluded.
    expect(source).not.toContain("moonpay_selfcustody_enabled: boolean");
    expect(source).not.toContain('flag: "moonpay_selfcustody_enabled"');
    expect(PLATFORM_FLAGS_ALL_OFF).not.toHaveProperty(
      "moonpay_selfcustody_enabled",
    );
  });
});

describe("flag-gated features follow their platform flag", () => {
  for (const feature of FLAG_GATED) {
    it(`${feature}: hidden for role user while its flag is off`, () => {
      expect(isFeatureVisible(feature, USER, ALL_OFF)).toBe(false);
    });

    it(`${feature}: visible for role user once every flag is on`, () => {
      expect(isFeatureVisible(feature, USER, ALL_ON)).toBe(true);
    });

    it(`${feature}: each of its own flags alone is enough to reveal it`, () => {
      for (const flag of flagsOf(feature)) {
        const onlyThat = { ...ALL_OFF, [flag]: true } as PlatformFeatureFlags;
        expect(isFeatureVisible(feature, USER, onlyThat)).toBe(true);
      }
    });
  }
});

describe("flag-less features are hidden from regular users under every flag state", () => {
  for (const feature of FLAG_LESS) {
    it(`${feature}: hidden for user with flags off AND on`, () => {
      expect(isFeatureVisible(feature, USER, ALL_OFF)).toBe(false);
      expect(isFeatureVisible(feature, USER, ALL_ON)).toBe(false);
    });
  }
});

describe("admin tier bypasses the gate entirely", () => {
  for (const roles of [ADMIN, SUPER_ADMIN]) {
    it(`roles ${roles}: every feature visible with all flags off`, () => {
      for (const feature of ALL_FEATURES) {
        expect(isFeatureVisible(feature, roles, ALL_OFF)).toBe(true);
      }
      const map = visibleFeatures(roles, ALL_OFF);
      expect(Object.keys(map)).toHaveLength(ALL_FEATURES.length);
      expect(Object.values(map).every(Boolean)).toBe(true);
    });
  }

  it("guests see no gated feature while flags are off (the live state)", () => {
    for (const feature of ALL_FEATURES) {
      expect(isFeatureVisible(feature, GUEST, ALL_OFF)).toBe(false);
    }
    expect(
      Object.values(visibleFeatures(GUEST, ALL_OFF)).some(Boolean),
    ).toBe(false);
  });

  it("guests see flag-gated features once live, never flag-less ones", () => {
    // A flag flipping on makes the feature a live product surface —
    // public entry points (footer, marketing) may then show it.
    // Flag-less features are unfinished work and stay hidden from
    // everyone outside the admin tier under every flag state.
    for (const feature of FLAG_GATED) {
      expect(isFeatureVisible(feature, GUEST, ALL_ON)).toBe(true);
    }
    for (const feature of FLAG_LESS) {
      expect(isFeatureVisible(feature, GUEST, ALL_ON)).toBe(false);
    }
  });

  it("a mixed role set containing admin is admin tier", () => {
    expect(isFeatureVisible("virtualCards", ["user", "admin"], ALL_OFF)).toBe(true);
  });
});

describe("mobile-money providers resolve per provider flag", () => {
  it("mtn follows mtn_momo_enabled only", () => {
    expect(isMobileMoneyProviderVisible("mtn", USER, ALL_OFF)).toBe(false);
    expect(
      isMobileMoneyProviderVisible("mtn", USER, { ...ALL_OFF, mtn_momo_enabled: true }),
    ).toBe(true);
    expect(
      isMobileMoneyProviderVisible("mtn", USER, { ...ALL_OFF, airtel_money_enabled: true }),
    ).toBe(false);
  });

  it("airtel follows airtel_money_enabled only", () => {
    expect(isMobileMoneyProviderVisible("airtel", USER, ALL_OFF)).toBe(false);
    expect(
      isMobileMoneyProviderVisible("airtel", USER, { ...ALL_OFF, airtel_money_enabled: true }),
    ).toBe(true);
  });

  it("zamtel has no integration: admin tier only, whatever the flags", () => {
    expect(isMobileMoneyProviderVisible("zamtel", USER, ALL_ON)).toBe(false);
    expect(isMobileMoneyProviderVisible("zamtel", ADMIN, ALL_OFF)).toBe(true);
    expect(isMobileMoneyProviderVisible("zamtel", SUPER_ADMIN, ALL_OFF)).toBe(true);
  });
});

describe("route map integrity", () => {
  it("no working route is gated", () => {
    const gated = new Set(Object.keys(FEATURE_ROUTE_MAP));
    for (const route of WORKING_FEATURE_ROUTES) {
      expect(gated.has(route), `working route ${route} must not be gated`).toBe(false);
    }
  });

  it("every gated route maps to a registered feature", () => {
    for (const [route, feature] of Object.entries(FEATURE_ROUTE_MAP)) {
      expect(ALL_FEATURES, `${route} → ${feature}`).toContain(feature);
    }
  });

  it("every gated route is wrapped in FeatureRouteGate in AnimatedRoutes", () => {
    const routes = read("../../src/components/AnimatedRoutes.tsx");
    for (const [route, feature] of Object.entries(FEATURE_ROUTE_MAP)) {
      expect(
        routes,
        `route ${route} must be gated`,
      ).toContain(`path="${route}"`);
      expect(routes).toContain(`<FeatureRouteGate feature="${feature}"`);
    }
  });

  it("the public legacy checkout route uses the gate's public mode", () => {
    const routes = read("../../src/components/AnimatedRoutes.tsx");
    expect(routes).toContain(
      '<FeatureRouteGate feature="legacyCheckout" publicRoute>',
    );
  });

  it("data-stranding carve-outs are wired: receiving accounts + card ownership checks", () => {
    const routes = read("../../src/components/AnimatedRoutes.tsx");
    expect(routes).toContain("dataCheck={hasOwnReceivingAccount}");
    expect(routes).toContain("dataCheck={ownsVirtualCard}");
  });
});

describe("surface pins — entry points consult the registry", () => {
  const header = read("../../src/components/Header.tsx");
  const footer = read("../../src/components/Footer.tsx");
  const wallet = read("../../src/pages/Wallet.tsx");

  it("header nav gates every hidden destination in desktop and mobile menus", () => {
    for (const feature of [
      "bankTransfers",
      "virtualCards",
      "cardVault",
      "payLater",
      "collectPayments",
      "settlements",
      "billPayments",
      "agentNetwork",
    ]) {
      expect(header).toContain(`canSeeFeature('${feature}'`);
    }
  });

  it("footer gates the USSD and virtual-card links", () => {
    expect(footer).toContain("'/ussd-access': 'ussdAccess'");
    expect(footer).toContain("'/card/new': 'virtualCards'");
  });

  it("wallet filters deposit options to available ones for regular users", () => {
    expect(wallet).toContain("allDepositOptions.filter((option) => option.available)");
  });

  it("wallet routes non-admins with payout records to the read-only view, never the forms", () => {
    expect(wallet).toContain(
      "{adminTier ? <WithdrawContent /> : <ExistingPayoutsView />}",
    );
    expect(wallet).toContain("const showWithdraw = adminTier || hasPayoutRecords === true;");
  });

  it("the read-only payouts view masks account numbers and offers no money-moving action", () => {
    const view = read("../../src/components/wallet/ExistingPayoutsView.tsx");
    expect(view).toContain("maskAccountNumber");
    expect(view).not.toContain("functions.invoke");
    expect(view).not.toContain("handleAddMethod");
  });

  it("guest checkout lists no unavailable rail (source-level, complements checkoutBitcoinOnly)", () => {
    const checkout = read("../../src/pages/PublicCheckout.tsx");
    expect(checkout).not.toContain("available: false");
  });
});
