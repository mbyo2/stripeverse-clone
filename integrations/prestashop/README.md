# BMaGlass Pay for PrestaShop

Accept BMaGlass Pay in PrestaShop 1.7+ / 8.x. Buyers pay on
BMaGlass's hosted payment page from their BMaGlass wallet; the money
lands in the **same BMaGlass account and wallets**. The API client
is the PHP SDK (`sdk/php`), vendored **verbatim** in
`bmaglasspay/classes/sdk/` (byte-identical — verified by
`integrations/check-vendored-clients.sh`).

## How it works

- Checkout (live key + ZMW/USD store currency only; otherwise the
  option hides rather than faking a sandbox or inventing an FX
  rate): the order is created in "Awaiting BMaGlass payment", one
  payment link is created for the exact total, and the buyer is
  redirected to the hosted page.
- Settlement: the HMAC-verified webhook (module controller
  `webhook`) nudges reconciliation; the module also reconciles from
  the configuration page ("Check pending orders"). Paid links mark
  orders paid **exactly once**.

## Install

1. Zip the `bmaglasspay/` folder and install it via **Modules →
   Module Manager → Upload a module** (or copy it to `modules/`).
2. Configure: paste your API key; register the webhook URL shown in
   the module settings in BMaGlass Pay and paste the signing secret
   shown once; use **Test connection** to see your wallets.
3. Keep the store currency ZMW or USD where BMaGlass should appear.

## Honest limits

- Wallet-to-wallet only (buyers need a BMaGlass account).
- Test keys are read-only by design: connection checks only.
- Because link settlement is confirmed by polling, there can be a
  short delay between the buyer paying and the order flipping to
  paid (the webhook nudge makes it near-instant when deliveries
  flow). PrestaShop has no built-in cron: for hands-off operation,
  hit the module's reconcile action from your server cron via the
  configuration page, or rely on webhook nudges + the shop's normal
  admin visits.

## Verification status

`php -l` clean on every file; the vendored client is byte-identical
to the PHP SDK client whose live-API protocol proof passed in the
connectors mission. A full PrestaShop runtime install was not
available in the build sandbox — smoke-test on staging first.
