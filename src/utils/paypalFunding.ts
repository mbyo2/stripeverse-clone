// The two ways a payer can pay THROUGH PayPal (CEO directive
// 2026-10-27): clicking the top-level "PayPal" method opens these
// PayPal-specific options —
//
//   1. Card via PayPal — pay with a debit or credit card on PayPal's
//      own page (PayPal guest checkout). PayPal processes the card;
//      no PayPal account is needed.
//   2. PayPal account — sign in to PayPal and pay from the PayPal
//      balance or a linked bank account or card (PayPal-to-PayPal).
//
// Both options complete through the SAME PayPal order the platform
// already creates (wallet-deposit / process-payment): PayPal's
// hosted checkout natively offers both funding routes, and the
// choice made here only steers which PayPal page opens first, via
// the Orders API `application_context.landing_page` the server maps
// from the intent below (LOGIN → the PayPal sign-in page, BILLING →
// the card form). The payer can still switch on PayPal's page, and
// settlement is unchanged: capture-confirmed, exactly once.
//
// ARCHITECTURE (so the future direct card rail can never be
// confused with card-via-PayPal): these are FUNDING options inside
// the PayPal method only — never top-level payment methods. Their
// values are namespaced "paypal_*" so they cannot collide with a
// top-level method value. When the platform's own direct card
// connection (Mastercard) goes live it joins the pickers as its own
// top-level "Card" SIBLING next to PayPal — it is not, and must
// never become, an entry in this list.

export type PayPalFunding = "paypal_card" | "paypal_account";

/** PayPal Orders API application_context.landing_page values. */
export type PayPalLandingPage = "BILLING" | "LOGIN";

export interface PayPalFundingOption {
  /** Intent value sent to the deposit/checkout functions. */
  value: PayPalFunding;
  /** Short label for the option row. */
  title: string;
  /** Plain-language explanation of what happens if chosen. */
  description: string;
  /** Which PayPal page the order asks to open first. */
  landingPage: PayPalLandingPage;
}

export const PAYPAL_FUNDING_OPTIONS: readonly PayPalFundingOption[] = [
  {
    value: "paypal_card",
    title: "Card via PayPal",
    description:
      "Pay with a debit or credit card on PayPal's secure page — no PayPal account needed. PayPal processes the card payment.",
    landingPage: "BILLING",
  },
  {
    value: "paypal_account",
    title: "PayPal account",
    description:
      "Sign in to PayPal and pay from your PayPal balance, or a bank account or card linked to it.",
    landingPage: "LOGIN",
  },
];

/**
 * The pre-selected option: the PayPal account route — the closest
 * match to how a PayPal payment behaved before the choice existed.
 */
export const DEFAULT_PAYPAL_FUNDING: PayPalFunding = "paypal_account";

export function isPayPalFunding(value: unknown): value is PayPalFunding {
  return value === "paypal_card" || value === "paypal_account";
}

export function paypalFundingOption(
  value: PayPalFunding,
): PayPalFundingOption {
  return (
    PAYPAL_FUNDING_OPTIONS.find((option) => option.value === value) ??
    PAYPAL_FUNDING_OPTIONS[PAYPAL_FUNDING_OPTIONS.length - 1]
  );
}

/** The PayPal landing page a funding choice asks the server to use. */
export function paypalLandingPageForFunding(
  value: PayPalFunding,
): PayPalLandingPage {
  return paypalFundingOption(value).landingPage;
}
