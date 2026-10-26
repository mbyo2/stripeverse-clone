# BMaGlass Pay SDK for PHP

A framework-free PHP client for the BMaGlass Pay developer API —
wallets, transactions, transfers, payment links, Bitcoin and
webhooks, against your own BMaGlass Pay account and wallets.

This is the same client the WooCommerce plugin ships (lifted from
`integrations/wordpress`), wrapped as a PSR-4 package
(`BMaGlass\Sdk\`). It also powers the Magento, PrestaShop and
OpenCart connectors, which vendor it.

## Install

This package lives in the BMaGlass Pay repository under `sdk/php`.
It is **not published on Packagist** — install it from the repo:

```bash
composer require bmaglass/bmaglass-sdk --no-install  # after adding the repo as a path/vcs repository
```

or simply copy `src/` into your project and register the
`BMaGlass\Sdk\` PSR-4 prefix (two files: `Client.php`,
`ApiException.php`). Requires PHP 7.4+ with cURL and JSON.

## Use

```php
use BMaGlass\Sdk\Client;
use BMaGlass\Sdk\ApiException;

$client = new Client(getenv('BMAGLASS_API_KEY')); // bmp_live_... or bmp_test_...

$wallets = $client->wallets();                       // your real wallets + balances
$link    = $client->createPaymentLink('Order #7', 250.00, 'ZMW');
$url     = Client::paymentLinkUrl($link['link_code']); // https://bmaglasspay.online/pay/<code>

try {
    $client->createTransfer($toUserId, 100, 'ZMW', 'Payout', null, 'idem-key-1');
} catch (ApiException $e) {
    echo $e->userMessage(); // plain language, safe to show
}

// Webhook verification (X-BMaGlass-Signature over the exact raw body):
$event = Client::parseWebhookEvent(file_get_contents('php://input'),
                                   $_SERVER['HTTP_X_BMGLASS_SIGNATURE'] ?? '',
                                   $webhookSecret);
```

## Honest limits

- **Test keys are read-only.** BMaGlass Pay has no test-mode ledger,
  so `bmp_test_` keys can read and register webhooks but can never
  move money; writes fail with a typed `403 test_mode_read_only`.
- **Currencies:** ZMW and USD — the currencies BMaGlass wallets
  hold. Anything else throws `unsupported_currency`; no exchange
  rate is ever invented.
- Webhook events that really occur today: `transaction.completed`
  (your own API transfers), `payment_link.created`,
  `payment_link.paid` (a payment link was paid — exactly once per
  settlement), `webhook.test`.

## Test

```bash
php sdk/php/tests/run-tests.php   # stub transport + shared HMAC known-answer vector
```
