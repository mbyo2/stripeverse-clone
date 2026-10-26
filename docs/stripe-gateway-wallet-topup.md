# Stripe Gateway — Wallet Top-Up Rail — REMOVED 2026-10-26

This document described the Stripe gateway wallet top-up rail
(`stripe-gateway-checkout` / `stripe-gateway-webhook` /
`stripe-gateway-admin`). That rail has been **removed** by CEO
decision (2026-10-26).

Stripe was a **feature benchmark** for BMaGlass Pay, never a
standing integration: the Stripe-style gateway features the
platform needs — hosted checkout, payment links, a developer API
with webhooks — are BMaGlass Pay's own platform features, and
card acceptance/payouts are delivered through **Mastercard**
(Mastercard Move + virtual cards, see the gateway integrations
brief §1). The rail was dark for its entire life: no
`STRIPE_GATEWAY_*` secrets were ever set in production, the kill
switch (`platform_settings.stripe_gateway_enabled`) was off, its
surfaces were superadmin-only, and it never carried real money
(zero ledger rows with the rail's marker exist).

What was removed: the three edge functions (also undeployed from
the project), `_shared/stripe-gateway.ts` +
`_shared/stripe-gateway-server.ts`, the Wallet "Card (Stripe)"
deposit option, `src/hooks/useStripeGatewayDeposit.ts`,
`src/config/stripeGateway.ts`, the `/admin/stripe` console, and
`tests/payments/stripeGateway.test.ts`.

Left in place deliberately: the inert
`platform_settings.stripe_gateway_enabled` column and the
`complete_stripe_wallet_deposit` RPC (migration `20261106`) — no
code reads them, and dropping database objects was out of scope
for this removal.

Note: the platform's separate, pre-existing subscription billing
via Stripe (`create-checkout` / `customer-portal`) is a different
surface and was NOT part of this removal.
