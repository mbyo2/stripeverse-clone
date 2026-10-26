# BMaGlass Pay for OpenCart 4

Accept BMaGlass Pay in OpenCart 4.x. Buyers pay on BMaGlass's
hosted payment page from their BMaGlass wallet; the money lands in
the **same BMaGlass account and wallets**. The API client is the
PHP SDK (`sdk/php`), vendored **verbatim** under
`upload/system/library/bmaglass/` (byte-identical — verified by
`integrations/check-vendored-clients.sh`).

## How it works

- Checkout (enabled + live key + ZMW/USD store currency only):
  confirm creates ONE payment link per order and redirects the
  buyer to the hosted page.
- Settlement: the HMAC-verified callback receives
  `payment_link.paid` and reconciles that order immediately
  (`GET /payment-links` matched to the stored per-order link code,
  confirmed via the API); the polling reconciliation remains as
  the fallback. Paid orders flip to the configured paid status
  **exactly once**.

## Install

1. Copy the contents of `upload/` over your OpenCart root
   (or zip `upload/` as an extension archive and install via
   **Extensions → Installer**).
2. **Extensions → Extensions → Payments → BMaGlass Pay → Install**,
   then Edit: enable, paste your API key, use **Test connection**
   to see your wallets, register the shown webhook URL in
   BMaGlass Pay and paste the signing secret shown once, and pick
   the paid order status.
3. Keep the store currency ZMW or USD where BMaGlass should appear
   (other currencies hide the method — no invented FX rate).

## Honest limits

- Wallet-to-wallet only (buyers need a BMaGlass account).
- Test keys are read-only by design: connection check only;
  checkout requires a live key.

## Verification status

`php -l` clean on every file; the vendored client is byte-identical
to the PHP SDK client whose live-API protocol proof passed in the
connectors mission. A full OpenCart runtime install was not
available in the build sandbox — smoke-test on staging first.
