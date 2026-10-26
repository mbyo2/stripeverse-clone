# BMaGlass Pay on Shopify — honest assessment

**There is deliberately no Shopify "plugin" in this repo.** A real
Shopify checkout payment integration cannot be built by writing
code in a repository — Shopify gates it. This document records what
is actually possible today, what works now without approval, and
what the formal route would unlock.

## Why there's no checkout integration code

- Shopify checkout payments run through **Shopify Payments
  partners**: a payment provider must apply to Shopify's payments
  partner programme, pass their review, and build a **payments
  extension/app** under that programme. Only then can the provider
  appear as a gateway at checkout.
- Anything else claiming to be a "Shopify BMaGlass checkout
  integration" (redirect hacks injected into the cart, off-checkout
  buttons presented as checkout) would misrepresent the product and
  risk the merchant's store. We don't ship that.

## What works TODAY (no approval needed)

1. **Payment links anywhere links are allowed.** Create BMaGlass
   payment links (app or developer API) and place them in:
   product descriptions, pages, blog posts, order-confirmation and
   marketing emails, and Shopify Flow / Klaviyo messages. The buyer
   lands on the hosted BMaGlass page and pays wallet-to-wallet;
   the money settles into your normal BMaGlass wallets.
2. **The universal embed** (`integrations/embed/`): the pay button
   snippet can be pasted into a Shopify theme's custom-liquid block
   or a page, bound to a payment link.
3. **Manual payment method.** In Shopify admin → Settings →
   Payments → Manual payment methods, add "BMaGlass Pay" with
   instructions ("we'll send you a BMaGlass payment link / pay to
   our BMaGlass account") — the classic off-platform method. Orders
   are marked paid manually after you see the money in BMaGlass
   (or reconcile via the API: `GET /payment-links` payment counts,
   `GET /transactions`).
4. **Draft orders.** Create a draft order in Shopify, send the
   customer the invoice together with a BMaGlass payment link for
   the same total, and complete the draft when the link shows paid
   (API-checkable). Amounts must match manually — Shopify and
   BMaGlass do not sync automatically today.

Amounts: BMaGlass wallets are ZMW and USD. A Shopify store priced
in another currency cannot be mapped onto BMaGlass without an
exchange rate — we do not invent one; set the store (or a market)
to ZMW/USD for BMaGlass flows.

## What the partner route would unlock

Applying to Shopify's payments partner programme (an organisational
application by BMaGlass — business review, compliance, payout and
support requirements) would eventually allow a true payments app:
BMaGlass appearing at checkout, order state synced automatically,
refunds via the admin. Until/unless that approval exists, the four
paths above are the whole honest offer, and this file is the
deliverable for Shopify.

## Recommendation

Use payment links + the embed now (zero approval, live today). If
Shopify volume justifies it, BMaGlass files the payments-partner
application as a business decision — that's a CEO/board action,
not a coding task, so no code here pretends otherwise.
