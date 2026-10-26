=== BMaGlass Pay for WooCommerce ===
Contributors: bmaglasspay
Tags: payments, woocommerce, bmaglass, zambia, kwacha
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

Accept BMaGlass Pay payments in WooCommerce. Buyers pay wallet-to-wallet on a hosted BMaGlass payment page; money lands in the same BMaGlass wallets (ZMW / USD) as your BMaGlass Pay app account.

== Description ==

BMaGlass Pay for WooCommerce connects your store to your existing BMaGlass Pay account through the BMaGlass Pay developer API — same account, same wallets, no separate merchant balance.

How it works:

1. At checkout the plugin creates a BMaGlass payment link for the exact order total and sends the buyer to the hosted BMaGlass payment page.
2. The buyer pays from their BMaGlass Pay wallet.
3. When the link is paid, BMaGlass sends a signed payment_link.paid webhook and the plugin marks the order paid immediately — exactly once. (Reconciliation also runs every 5 minutes, plus an immediate check when the buyer returns, plus a per-order "Check BMaGlass payment" action, as a fallback for any missed delivery.)

Requirements and honest limits:

* Store currency must be ZMW or USD — those are the currencies BMaGlass wallets hold. The plugin refuses other currencies plainly; it never invents an exchange rate.
* A live API key (bmp_live_...) is required to take payments. Test keys (bmp_test_...) are read-only by design across BMaGlass Pay — there is no test-mode ledger — so a test key can check the connection and read wallets, but can never take a payment. The plugin says so instead of pretending to sandbox.
* Buyers pay from a BMaGlass Pay wallet on the hosted payment page; guest card checkout is not offered.

Webhooks: the plugin registers an HMAC-SHA256-verified webhook endpoint with BMaGlass (one click in the gateway settings). Signed webhook.test events prove connectivity, and every signed event is logged. The payment_link.paid event completes orders the moment a link is paid; API reconciliation remains as the fallback.

== Installation ==

1. Copy the `bmaglass-pay` folder into `wp-content/plugins/` (or zip it and use Plugins → Add New → Upload).
2. Activate "BMaGlass Pay for WooCommerce".
3. Go to WooCommerce → Settings → Payments → BMaGlass Pay.
4. Create an API key in BMaGlass Pay (Business settings or the API page) with the `wallets:read`, `payment_links:read` and `payment_links:write` scopes, paste it in, enable the gateway, and save.
5. Click "Test connection" — you should see your account's wallets and balances.
6. Click "Register webhook" to point BMaGlass at this site and store the signing secret.
7. Set your store currency to ZMW or USD and place a real order to see the flow end to end.

== Frequently Asked Questions ==

= Do I need a separate BMaGlass merchant account? =
No. The API key belongs to your normal BMaGlass Pay account; payments settle into the same ZMW/USD wallets you see in the app.

= Why can't I test checkout with a test key? =
BMaGlass Pay has no test-mode ledger, so test keys are read-only everywhere (app API, SDKs, and this plugin). Use a test key to verify the connection and wallets; use a live key — and a small real order — to test checkout.

= How does the plugin know an order was paid? =
BMaGlass tells it: the signed payment_link.paid webhook fires when the payment link is paid, and the plugin completes the order immediately, exactly once, with the link code as the reference. As a fallback it also reconciles — every 5 minutes (and on the buyer's return, and on demand from the order screen) it checks the order's payment link via the API and completes any order whose delivery was missed.

= Which fees apply? =
Payment-link settlement follows your BMaGlass Pay account's standard link settlement terms (shown in the app). The plugin adds no fees of its own.

== Changelog ==

= 1.0.0 =
* First release: gateway, hosted payment-link checkout, reconciliation, HMAC-verified webhook endpoint, connection tools.
