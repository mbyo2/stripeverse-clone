// Connector config + API-key environment logic — shared by the
// developer-api edge function and the vitest suite (deliberately free
// of Deno-specific APIs, same pattern as _shared/developer-webhooks.ts).
//
// The rules pinned here are the CEO-approved API key system design
// (2026-11-09):
//   - Two environments: sandbox (keys bmg_sandbox_…, legacy bmp_test_…)
//     and production (bmg_live_…, legacy bmp_live_…). The environment
//     comes ONLY from the key presented — never from a request
//     parameter, header or plugin setting.
//   - Sandbox runs on mainnet formats with simulated money. There is
//     NO testnet anywhere in this system.
//   - The connector config payload is built from the business's
//     authoritative record (merchant_accounts) at call time. Feature
//     gates are re-checked server-side on every money call; this
//     payload only tells the connector what to render.
//   - Mobile money is a Zambia-only feature: entitled only when the
//     business's saved country resolves to ZM, and "enabled" only
//     when the business has also turned its toggle on. The word for
//     the underlying rail never appears in any payload built here.

export type Environment = "sandbox" | "production";
/** Storage value used by existing tables (api_keys.mode, object rows). */
export type ModeValue = "test" | "live";

export function modeToEnvironment(mode: string | null | undefined, keyPrefix?: string | null): Environment {
  if (mode === "live") return "production";
  if (mode === "test") return "sandbox";
  // Legacy rows without a mode: derive from the stored prefix.
  return (keyPrefix ?? "").includes("live") ? "production" : "sandbox";
}

export function environmentToMode(env: Environment): ModeValue {
  return env === "production" ? "live" : "test";
}

/** Key prefixes this platform has ever issued. bmp_ keys stay valid:
 *  they were sold as permanent credentials and the hash lookup — not
 *  the prefix — is what authenticates a key. */
export const KEY_PREFIXES = {
  sandbox: "bmg_sandbox_",
  production: "bmg_live_",
  legacySandbox: "bmp_test_",
  legacyProduction: "bmp_live_",
} as const;

export function isApiKeyShape(raw: string): boolean {
  return raw.startsWith("bmg_") || raw.startsWith("bmp_");
}

export function environmentFromKeyString(raw: string): Environment | null {
  if (raw.startsWith(KEY_PREFIXES.production) || raw.startsWith(KEY_PREFIXES.legacyProduction)) return "production";
  if (raw.startsWith(KEY_PREFIXES.sandbox) || raw.startsWith(KEY_PREFIXES.legacySandbox)) return "sandbox";
  return null;
}

/** Least-privilege scope allowlist for newly issued keys. Nothing on
 *  this list can withdraw, pay out, change a settlement destination,
 *  change the business country, or manage keys — by construction. */
export const ALLOWED_KEY_SCOPES = [
  "config:read",
  "invoices:create",
  "invoices:read",
  "webhooks:manage",
  "webhooks:read",
  "webhooks:write",
  "wallets:read",
  "transactions:read",
  "payment_links:read",
  "payment_links:write",
  "bitcoin:read",
  "transfers:write",
] as const;

export const DEFAULT_KEY_SCOPES = [
  "config:read",
  "invoices:create",
  "invoices:read",
  "webhooks:manage",
  "wallets:read",
  "transactions:read",
  "payment_links:read",
  "payment_links:write",
  "bitcoin:read",
] as const;

export function sanitizeScopes(input: unknown): { scopes: string[]; rejected: string[] } {
  if (!Array.isArray(input) || input.length === 0) {
    return { scopes: [...DEFAULT_KEY_SCOPES], rejected: [] };
  }
  const allowed = new Set<string>(ALLOWED_KEY_SCOPES as unknown as string[]);
  const scopes: string[] = [];
  const rejected: string[] = [];
  for (const s of input) {
    if (typeof s !== "string") continue;
    if (allowed.has(s)) { if (!scopes.includes(s)) scopes.push(s); }
    else rejected.push(s);
  }
  return { scopes, rejected };
}

// ── Country handling ────────────────────────────────────────────────
// The business country is saved as free text in the app ("Zambia").
// The config contract speaks ISO 3166-1 alpha-2, so resolve names to
// codes here; an unresolvable name yields null (never a guess).

const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  zambia: "ZM", zimbabwe: "ZW", "south africa": "ZA", kenya: "KE",
  nigeria: "NG", ghana: "GH", tanzania: "TZ", uganda: "UG",
  rwanda: "RW", botswana: "BW", namibia: "NA", mozambique: "MZ",
  malawi: "MW", angola: "AO", "dr congo": "CD",
  "democratic republic of the congo": "CD", congo: "CG",
  ethiopia: "ET", egypt: "EG", morocco: "MA", algeria: "DZ",
  cameroon: "CM", senegal: "SN", "ivory coast": "CI", "côte d'ivoire": "CI",
  "united states": "US", "united states of america": "US", usa: "US",
  "united kingdom": "GB", "great britain": "GB", uk: "GB",
  canada: "CA", germany: "DE", france: "FR", netherlands: "NL",
  india: "IN", china: "CN", "united arab emirates": "AE", uae: "AE",
};

const ISO_TO_CURRENCY: Record<string, string> = {
  ZM: "ZMW", ZW: "USD", ZA: "ZAR", KE: "KES", NG: "NGN", GH: "GHS",
  TZ: "TZS", UG: "UGX", RW: "RWF", BW: "BWP", NA: "NAD", MZ: "MZN",
  MW: "MWK", AO: "AOA", CD: "CDF", ET: "ETB", EG: "EGP", MA: "MAD",
  US: "USD", GB: "GBP", CA: "CAD", DE: "EUR", FR: "EUR", NL: "EUR",
  IN: "INR", CN: "CNY", AE: "AED",
};

export function countryToIso(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_NAME_TO_ISO[v.toLowerCase()] ?? null;
}

export function currencyForCountry(iso: string | null): string | null {
  if (!iso) return null;
  return ISO_TO_CURRENCY[iso] ?? null;
}

// ── Feature model ───────────────────────────────────────────────────

export type FeatureStatus = "enabled" | "disabled" | "not_entitled" | "pending_verification";
export interface FeatureState { status: FeatureStatus; reason_code: string | null }

export interface BusinessFacts {
  hasBusinessRecord: boolean;
  displayName: string | null;
  countryIso: string | null;
  /** merchant_accounts.status passthrough ('pending' default), or 'not_set_up'. */
  businessStatus: string;
  frozen: boolean;
  mobileMoneyToggleOn: boolean;
}

/** The mobile-money gate matrix, in one place:
 *   no business record        → pending_verification / business_not_set_up
 *   country ≠ ZM (or unknown) → not_entitled / country_not_eligible
 *   ZM + toggle off           → disabled / null (the business's own choice)
 *   ZM + toggle on            → enabled */
export function mobileMoneyFeature(facts: BusinessFacts): FeatureState {
  if (!facts.hasBusinessRecord) {
    return { status: "pending_verification", reason_code: "business_not_set_up" };
  }
  if (facts.countryIso !== "ZM") {
    return { status: "not_entitled", reason_code: "country_not_eligible" };
  }
  if (!facts.mobileMoneyToggleOn) {
    return { status: "disabled", reason_code: null };
  }
  return { status: "enabled", reason_code: null };
}

export function buildConnectorConfig(input: {
  environment: Environment;
  keyId: string;
  keyScopes: string[];
  facts: BusinessFacts;
}) {
  const { environment, facts } = input;
  const sandbox = environment === "sandbox";
  return {
    environment,
    livemode: environment === "production",
    key: {
      key_id: input.keyId,
      scopes: input.keyScopes,
      status: "active",
    },
    business: {
      display_name: facts.displayName,
      country: facts.countryIso,
      currency: currencyForCountry(facts.countryIso),
      status: facts.frozen ? "frozen" : facts.businessStatus,
    },
    features: {
      invoices: { status: "enabled", reason_code: null } as FeatureState,
      payment_links: { status: "enabled", reason_code: null } as FeatureState,
      bitcoin: { status: "enabled", reason_code: null } as FeatureState,
      // Real internal transfers move real money, so in the sandbox
      // they are off; sandbox payments settle through the invoice /
      // payment-link simulation instead.
      transfers: (sandbox
        ? { status: "disabled", reason_code: "sandbox_simulation_only" }
        : { status: "enabled", reason_code: null }) as FeatureState,
      mobile_money: mobileMoneyFeature(facts),
    },
    // Settlement TYPE and currency only — never destinations, numbers
    // or balances.
    settlement: {
      type: "wallet",
      currency: currencyForCountry(facts.countryIso),
    },
  };
}
