# Stripe Gateway — Wallet Top-Up Rail

Customers pay IN by card through Stripe-hosted Checkout to top up
their BMaGlass wallet. Built per `gateway-integrations-api-brief.md`
§3 (the binding spec) as a one-to-one mirror of the proven PayPal
deposit rail. **Sandbox-first, superadmin-only**: the option renders
only for `admin` / `super_admin` and the checkout function enforces
the same gate server-side; publicly the feature is "Coming soon".

This rail is a *different merchant flow* from the subscription
Stripe (`create-checkout`, `STRIPE_SECRET_KEY`): separate keys,
separate webhook endpoint, separate ledger rows
(`payment_method = 'stripe'`). The two never share a secret.

## Pieces

| Piece | Path |
|---|---|
| Start top-up (authenticated, role-gated) | `supabase/functions/stripe-gateway-checkout` |
| Settlement webhook (verify_jwt OFF, Stripe-Signature auth) | `supabase/functions/stripe-gateway-webhook` |
| Pure decision logic (unit-tested) | `supabase/functions/_shared/stripe-gateway.ts` |
| Stripe API + settlement orchestration | `supabase/functions/_shared/stripe-gateway-server.ts` |
| Exactly-once credit RPC + kill switch | `supabase/migrations/20261106_stripe_gateway_deposit.sql` → `complete_stripe_wallet_deposit` |
| UI | Wallet page "Card (Stripe)" deposit option; `src/hooks/useStripeGatewayDeposit.ts`; `src/config/stripeGateway.ts` |
| Tests | `tests/payments/stripeGateway.test.ts` |

Settlement rule (same as PayPal): the webhook payload is a hint —
the session is re-queried from Stripe and the wallet is credited
only when the re-queried session is `payment_status = "paid"` with
amount and currency matching the pending ledger row, inside the
row-locked RPC. A replayed webhook never double-credits. Verified
Stripe money creates the same external-money provenance mark as a
verified PayPal capture (`paypal_taint_credit`).

## Secrets to set (names only — never values in docs or chat)

Supabase function secrets (project `paymentgetway`):

- `STRIPE_GATEWAY_SECRET_KEY` — test mode now: a **restricted key**
  `rk_test_…` scoped to Checkout Sessions *write*, Payment Intents
  *read*, Charges *read*, Events *read* (a plain `sk_test_…` also
  works). **Not** the subscription feature's `STRIPE_SECRET_KEY`.
- `STRIPE_GATEWAY_WEBHOOK_SECRET` — the `whsec_…` of the webhook
  endpoint below (each endpoint has its own).

Vercel env:

- `VITE_STRIPE_PUBLISHABLE_KEY` — `pk_test_…` now. The only Stripe
  key the browser may ever hold.

## Webhook endpoint to register in Stripe

Dashboard → Workbench → Webhooks → Create an event destination:

- **URL:** `https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/stripe-gateway-webhook`
- **Events:** `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `charge.refunded`
- Then set the endpoint's signing secret as
  `STRIPE_GATEWAY_WEBHOOK_SECRET` above.

## Deploy order

1. Apply migration `20261106_stripe_gateway_deposit.sql` (RPC +
   `platform_settings.stripe_gateway_enabled`, default `true` — set
   it `false` to disable the rail instantly).
2. Deploy `stripe-gateway-checkout` (verify_jwt **on**) and
   `stripe-gateway-webhook` (verify_jwt **off** — see
   `supabase/config.toml`).
3. Set the secrets above; register the webhook endpoint.
4. Prove in test mode with card `4242 4242 4242 4242` (any future
   expiry/CVC): top up as the superadmin → wallet credited once;
   replay the webhook from the Stripe dashboard → still credited
   once.

Without `STRIPE_GATEWAY_SECRET_KEY` the checkout function answers a
truthful `not_configured` and writes nothing — the rail is dark
until the keys exist.

## Currency note (ZMW)

ZMW is attempted first for ZMW wallets. Stripe recognises ZMW (it is
in Stripe's currency data and FX conversion lists), but presentment
is defined per account country and cannot be proven from docs for
this account — so if Stripe rejects the currency at session
creation, the same amount is charged in USD to the user's USD wallet
in the same account scope (the PayPal precedent), recorded on the
ledger row (`metadata.fallback_applied`) and reported in the
checkout response and the app. Never silent.

## Production swap = replace the three values with live ones

1. Swap `STRIPE_GATEWAY_SECRET_KEY` → live `rk_live_…`/`sk_live_…`
   and `VITE_STRIPE_PUBLISHABLE_KEY` → `pk_live_…`.
2. Register a **separate live** webhook endpoint (same URL, same
   events) and set its new `whsec_…` as
   `STRIPE_GATEWAY_WEBHOOK_SECRET` — test secrets never carry over.
3. Flip `STRIPE_GATEWAY_MODE` to `"live"` in
   `src/config/stripeGateway.ts` so the UI stops calling it a
   sandbox rail.
4. Re-confirm ZMW presentment in live mode; run one small real
   charge end-to-end (credit + provenance) before opening the rail
   beyond the superadmin. No code change beyond step 3.
