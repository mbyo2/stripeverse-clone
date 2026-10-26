// Mobile money availability gate (UI labels and defaults only).
//
// Mobile money deposits are not configured yet: the wallet-deposit
// function answers 'not_configured' for the mobile_money method until
// the direct mobile-money connections (MTN MoMo, Airtel Money,
// Zamtel — no aggregator) are live after telco merchant onboarding.
// This constant is how the UI says so honestly — the Add Money dialog
// labels the option "not available yet" and does not default to it.
//
// This is a presentation gate only, mirroring PAYPAL_AVAILABLE in
// src/config/paypal.ts: the deposit function remains the source of
// truth and still answers 'not_configured' if the method is chosen.
// When the rail is configured, flip this to `true` — the selector
// label and the default-selection logic follow automatically.
export const MOBILE_MONEY_AVAILABLE = false;

/** Plain-language suffix shown on a deposit method that is not live yet. */
export const NOT_AVAILABLE_YET_LABEL = "Not available yet";
