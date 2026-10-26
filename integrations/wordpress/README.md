# BMaGlass Pay for WooCommerce

A WooCommerce payment gateway that connects a WordPress store to the
merchant's existing BMaGlass Pay account — **same account, same
wallets (ZMW / USD)** — through the BMaGlass Pay developer API.

## Layout

```
bmaglass-pay/
  bmaglass-pay.php                       bootstrap: gateway registration, webhook route, cron, admin actions
  includes/class-bmaglass-api-client.php framework-free developer-API client (seed of sdk/php)
  includes/class-wc-gateway-bmaglass.php WC_Payment_Gateway implementation
  includes/class-bmaglass-reconciler.php settlement reconciliation (cron / thank-you / order action)
  uninstall.php                          removes settings (API key + webhook secret) and the cron schedule
  readme.txt                             WordPress plugin readme
tests/
  run-client-tests.php                   standalone PHP tests for the API client (no WordPress needed)
```

## Install

1. Copy `bmaglass-pay/` into `wp-content/plugins/` (or zip the folder
   and upload it under Plugins → Add New → Upload), then activate.
2. WooCommerce → Settings → Payments → **BMaGlass Pay**: paste an API
   key created in BMaGlass Pay (Business settings or the API page)
   with scopes `wallets:read`, `payment_links:read`,
   `payment_links:write`; enable and save.
3. **Test connection** — shows the account's wallets and whether the
   key is test or live.
4. **Register webhook** — registers this site's endpoint
   (`/wp-json/bmaglass/v1/webhook`) with BMaGlass, stores the
   one-time signing secret, and sends a signed `webhook.test` event.
5. Store currency must be **ZMW or USD**.

## How checkout and settlement work

- `process_payment` creates **one payment link per order** for the
  exact total (reused on retries — never duplicated) and redirects
  the buyer to the hosted page `https://bmaglasspay.online/pay/<code>`,
  where they pay wallet-to-wallet from their BMaGlass Pay account.
- The order sits **on-hold** until it is settled. Settlement is
  **push-first**: the developer API fires a signed `payment_link.paid`
  webhook the moment the link is paid, and this plugin's
  HMAC-verified endpoint completes the matching order immediately.
  `payment_complete()` runs exactly once with the link code as the
  reference.
- **Reconciliation is the fallback**: cron (5 min), the thank-you
  page and the per-order action still poll the link's
  `payment_count` / `total_collected` and complete any order whose
  webhook delivery was missed. Both paths share the same
  settled-flag + status guard, so they cannot double-complete.

**History:** this plugin originally confirmed orders by
reconciliation alone, because the API had no "payment link paid"
event. The event (`payment_link.paid`, exactly once per settlement)
has since shipped on the platform; the webhook handler now settles
from it directly and reconciliation remains as the safety net.

## Honest limits

- **Test keys are read-only** (platform-wide design: no test-mode
  ledger). Settings + connection checks work with a test key;
  checkout refuses with a plain-language explanation.
- **Currencies:** ZMW and USD only — the currencies BMaGlass wallets
  hold. Other store currencies are refused at checkout with an
  explanation; no exchange rate is ever invented.
- Buyers need a BMaGlass Pay wallet to pay (guest card checkout is
  not a BMaGlass feature today).

## Verification in this repo

- `php -l` clean on all five PHP files.
- `tests/run-client-tests.php` (PHP CLI, stub transport): mode
  detection, header/body shaping, typed error mapping incl.
  `test_mode_read_only`, currency guard, and the shared cross-SDK
  HMAC known-answer vector.
- Live protocol proof: the plugin's own client class was run from
  PHP CLI against the production developer API (QA merchant account,
  live key): wallets read, payment link created and re-fetched,
  webhook registered and test event delivered (see the connectors
  addendum in the completion-sweep goal for the dated record).
- A full WordPress + WooCommerce runtime install was not available
  in the build sandbox (no MySQL), so gateway-in-WordPress behaviour
  is verified by code review against the WooCommerce gateway API
  plus the executable client proofs above — stated plainly rather
  than claimed.
