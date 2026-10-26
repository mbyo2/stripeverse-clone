# BMaGlass Pay for Odoo

An Odoo payment provider that connects an Odoo instance to the
merchant's existing BMaGlass Pay account — **same account, same
wallets (ZMW / USD)** — through the BMaGlass Pay developer API.

## Layout

```
payment_bmaglass/
  __manifest__.py                  Odoo 17 addon manifest (depends: payment)
  models/bmaglass_api.py           vendored developer-API client (zero-dependency mirror of sdk/python)
  models/payment_provider.py       provider: credentials, currency support, connection tools, live-key gate
  models/payment_transaction.py    per-transaction payment link + reconciliation
  controllers/main.py              HMAC-verified webhook endpoint (/payment/bmaglass/webhook)
  views/                           provider form fields + redirect form template
  data/                            provider record + 5-minute reconciliation cron
  security/ir.model.access.csv   (fields only — access comes from the payment module)
  static/description/index.html    Apps-store style description
tests/
  test_bmaglass_client.py          standalone unit tests for the vendored client (no Odoo needed)
```

## Install

1. Copy `payment_bmaglass/` into your Odoo addons path and update the
   apps list, then install **Payment Provider: BMaGlass Pay**.
2. Invoicing/Accounting → Configuration → Payment Providers →
   **BMaGlass Pay**: paste an API key created in BMaGlass Pay
   (Business settings or the API page) with scopes `wallets:read`,
   `payment_links:read`, `payment_links:write`.
3. **Test connection** — shows the account's wallets and whether the
   key is test or live.
4. **Register webhook** — registers
   `https://<your-odoo>/payment/bmaglass/webhook` with BMaGlass,
   stores the one-time signing secret, and sends a signed
   `webhook.test` event.
5. Set the provider state to **Enabled** — this requires a live key
   (a `ValidationError` explains why if the key is a test key), and
   publish it like any Odoo provider.

## How checkout and settlement work

- Each payment transaction creates **one BMaGlass payment link** for
  the exact amount; the buyer is redirected to the hosted page
  `https://bmaglasspay.online/pay/<code>` and pays wallet-to-wallet
  from their BMaGlass Pay account.
- Settlement is **push-first**: the developer API fires a signed
  `payment_link.paid` webhook when the link is paid, and the module's
  HMAC-verified controller settles the matching transaction
  immediately (the payload is cross-checked — link code, currency,
  amount — before `_set_done()` runs).
- A **cron reconciliation every 5 minutes** remains as the fallback:
  when the link's `payment_count` / `total_collected` cover the
  transaction amount, the transaction is set to done. Both paths are
  exactly-once (Odoo's `_set_done()` is state-guarded).

**History:** this module originally settled by reconciliation alone,
because the API had no "payment link paid" event. The event
(`payment_link.paid`, exactly once per settlement) has since shipped
on the platform; the controller now settles from it directly and the
cron remains as the safety net.

## Honest limits

- **Test keys are read-only** (platform-wide design: no test-mode
  ledger). Connection checks work with a test key; enabling the
  provider for real payments requires a live key, enforced by a
  constraint with the explanation on it.
- **Currencies:** ZMW and USD only — the provider's supported
  currencies are intersected with the BMaGlass wallet currencies,
  and the client refuses anything else rather than inventing a rate.
- Buyers need a BMaGlass Pay wallet to pay (guest card checkout is
  not a BMaGlass feature today).
- The API client is vendored (`models/bmaglass_api.py`) because Odoo
  addons can't install the unpublished `bmaglass-sdk` package; it
  mirrors that SDK's surface and error codes exactly, including the
  shared HMAC test vector.

## Verification in this repo

- `python3 -m compileall` clean on the whole addon;
  `tests/test_bmaglass_client.py` — 7 tests (stub transport): mode
  detection, header/body shaping, typed `test_mode_read_only`
  mapping, currency guard, shared HMAC known-answer vector.
- Live protocol proof: the vendored client was run against the
  production developer API (QA merchant account, live key): wallets
  read, payment link created and re-fetched, webhook registered and
  test event delivered (dated record in the connectors addendum in
  the completion-sweep goal).
- A full Odoo runtime install was not available in the build sandbox
  (no PostgreSQL), so the provider/transaction glue is written to
  Odoo 17 payment-framework conventions and verified by review plus
  the executable client proofs — stated plainly rather than claimed.
