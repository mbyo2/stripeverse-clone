# BMaGlass Pay for Magento 2

Accept BMaGlass Pay payments in Magento 2 (Open Source / Adobe
Commerce). Buyers pay on BMaGlass's hosted payment page from their
BMaGlass wallet; the money lands in the **same BMaGlass account and
wallets** as everything else. Built on the PHP SDK
(`sdk/php`) — the API client is vendored at
`BMaGlass/Pay/Model/Api/` (identical to the SDK except the namespace;
verified by `integrations/check-vendored-clients.sh`).

## How it works

- Checkout: the order is placed as `pending_payment`, a payment link
  is created for the exact total (order currency, **ZMW/USD only**),
  and the buyer is redirected to the hosted page.
- Settlement: BMaGlass webhooks are HMAC-verified at
  `https://YOUR-STORE/bmaglass/webhook`. A `payment_link.paid` event
  reconciles its order immediately (confirmed via the API); a cron
  job (every 5 minutes) also polls the API's payment-link list as
  the fallback. Captures register **exactly once**.

## Install

1. Copy `BMaGlass/Pay` into `app/code/BMaGlass/Pay`.
2. `bin/magento module:enable BMaGlass_Pay && bin/magento setup:upgrade && bin/magento cache:flush`
3. **Stores → Configuration → Sales → Payment Methods → BMaGlass Pay:**
   enable, paste your API key (live key required for checkout —
   the method hides itself for test keys, because test keys are
   read-only by design), register the webhook URL above in BMaGlass
   Pay and paste the signing secret shown once.
4. Set your store currency to ZMW or USD for the store view where
   BMaGlass should appear (other currencies hide the method — no
   exchange rate is ever invented).

## Honest limits

- Wallet-to-wallet only: buyers need a BMaGlass account (guest
  checkout is disabled on BMaGlass Pay by decision).
- Test keys = connection/read checks only; there is no test-mode
  ledger to fake a sandbox checkout with, so checkout needs a live
  key.

## Verification status

`php -l` clean on every file; the vendored client is the SDK client
whose own live-API protocol proof passed in the connectors mission
(see the mission addendum). A full Magento runtime install was not
available in the build sandbox — install-level behaviour follows the
standard redirect-gateway pattern and should be smoke-tested on a
staging store before production.
