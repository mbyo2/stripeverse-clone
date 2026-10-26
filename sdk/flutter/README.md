# BMaGlass Pay SDK for Flutter

A thin Dart client over the BMaGlass Pay developer API — the same
surface as the TypeScript, Python, PHP and React Native SDKs:
wallets, transactions, transfers, payment links, Bitcoin and
webhooks, against your own BMaGlass Pay account.

## Install

This package lives in the BMaGlass Pay repository under
`sdk/flutter`. It is **not published on pub.dev** — depend on it
from the repo (path/git dependency) or copy `lib/` into your app.

```yaml
dependencies:
  bmaglass_sdk:
    path: ../bmaglass-pay/sdk/flutter   # adjust to your checkout
```

## Use

```dart
import 'package:bmaglass_sdk/bmaglass_sdk.dart';

final client = BMaGlass(apiKey: const String.fromEnvironment('BMGLASS_API_KEY'));

final wallets = await client.wallets();
final link = await client.createPaymentLink(title: 'Order #7', amount: 250, currency: 'ZMW');
final url = BMaGlass.paymentLinkUrl(link.linkCode); // open for the buyer

try {
  await client.createTransfer(toUserId: uid, amount: 100, currency: 'ZMW', idempotencyKey: 'key-1');
} on BMaGlassException catch (e) {
  showMessage(e.userMessage()); // plain language, safe to display
}

// Server-side / isolate webhook verification:
final event = parseWebhookEvent(rawBody, signatureHeader, webhookSecret);
```

## Honest limits & security

- **Test keys are read-only** (no test-mode ledger): reads work;
  writes throw `test_mode_read_only` with a plain-language message.
- **Currencies:** ZMW and USD only; anything else throws
  `unsupported_currency` — no FX rate is ever invented.
- **API keys are secrets.** A `bmp_live_` key moves real money. In a
  consumer app, prefer your own backend holding the key server-side;
  embed a key only for the key owner's own account use.

## Verification status

The Dart/Flutter toolchain is **not present in the build sandbox**
this package was authored in, so `dart analyze` / `dart test` have
not been run there. The tests in `test/bmaglass_sdk_test.dart` use
`package:http`'s MockClient (no network) and the same shared
cross-SDK HMAC known-answer vector as the other five SDK suites —
run them where a toolchain exists:

```bash
cd sdk/flutter && dart test   # or: flutter test
```

The client code itself is a line-for-line port of the proven Python
SDK structure (same endpoints, headers and error mapping).
