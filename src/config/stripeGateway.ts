// Stripe gateway (wallet top-up rail) — client-side configuration.
//
// This is the GATEWAY Stripe integration (brief §3): customers pay
// IN by card through Stripe Checkout to top up their wallets. It is
// a different merchant flow from the subscription Stripe in
// create-checkout / Pricing, with its own keys and its own webhook —
// the two never share a secret or a ledger.
//
// The only Stripe key the browser may ever hold is the PUBLISHABLE
// key, in Vercel env as VITE_STRIPE_PUBLISHABLE_KEY. The hosted
// Checkout redirect flow doesn't need it yet (the edge function
// creates the session and returns its URL), but the name is pinned
// here so no other client-side Stripe key name is ever introduced.
// The secret and webhook keys live only in Supabase function
// secrets: STRIPE_GATEWAY_SECRET_KEY / STRIPE_GATEWAY_WEBHOOK_SECRET.

/** The gateway publishable key (safe to expose), when configured. */
export const STRIPE_GATEWAY_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? "";

/**
 * Which Stripe mode the rail is running in, as far as the UI claims.
 * Starts as "test": sandbox keys are what get set first, and the UI
 * labels the option as a sandbox rail so nobody mistakes a test
 * charge for a real one. The production swap (brief §3.5) flips this
 * to "live" in the same change that swaps the three key values —
 * see docs/stripe-gateway-wallet-topup.md.
 */
export const STRIPE_GATEWAY_MODE: "test" | "live" = "test";

/** Suffix shown on the deposit-method option while in test mode. */
export const STRIPE_GATEWAY_MODE_LABEL =
  STRIPE_GATEWAY_MODE === "test" ? " — Sandbox" : "";
