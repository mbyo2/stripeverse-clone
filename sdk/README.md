# BMaGlass Pay SDKs

Clients for the shipped developer API (`developer-api` edge function).
Contract: `openapi.json` in this directory (also served by the app at `/openapi.json`).

- `typescript/` — `@bmaglass/sdk` v1.0.0: typed client, `BMaGlassError`, webhook verification helpers.
  Build: `npm install && npm run build`. Test: `npm test`.
- `python/` — `bmaglass-sdk` v1.0.0 (`bmaglass_sdk` package, requests-based): equivalent client +
  `verify_webhook_signature` / `parse_webhook_event`. Install: `pip install ./python`.
  Test: `python3 -m unittest discover sdk/tests -v` from the repo root.
- `php/` — `bmaglass/bmaglass-sdk` v1.0.0 (`BMaGlass\Sdk\`, framework-free, cURL): equivalent client +
  `Client::verifyWebhookSignature` / `Client::parseWebhookEvent`. Lifted from the WooCommerce
  plugin's client. Test: `php sdk/php/tests/run-tests.php`.
- `flutter/` — `bmaglass_sdk` (Dart): equivalent client for Flutter apps. See its README.
- `react-native/` — `@bmaglass/sdk-react-native`: equivalent client for React Native / Expo apps.
  See its README.

Honest limits: test keys (`bmp_test_…`) are read-only — this app has no test-mode ledger, so test
keys can never move money. The SDKs are in-repo only; they are not published to npm, PyPI, Packagist
or pub.dev yet.
