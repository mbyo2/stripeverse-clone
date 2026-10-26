# BMaGlass Pay SDK for React Native / Expo

A thin typed client over the BMaGlass Pay developer API — the same
surface as the TypeScript, Python and PHP SDKs, adapted for React
Native:

- `fetch`-based (global fetch; injectable for tests).
- Webhook verification uses a **bundled pure-TS HMAC-SHA256**
  (`src/sha256.ts`) because Hermes has no WebCrypto `subtle`. It is
  pinned by the shared cross-SDK known-answer vector and
  cross-checked against Node's crypto in the tests.

## Install

This package lives in the BMaGlass Pay repository under
`sdk/react-native`. It is **not published on npm** — add it from the
repo (e.g. as a file:/git dependency) or copy `src/` into your app.

## Use

```ts
import { BMaGlass, BMaGlassError, parseWebhookEvent, paymentLinkUrl } from "@bmaglass/sdk-react-native";

const client = new BMaGlass({ apiKey: process.env.BMGLASS_API_KEY! }); // bmp_live_... / bmp_test_...

const wallets = await client.wallets.list();
const link = await client.paymentLinks.create({ title: "Order #7", amount: 250, currency: "ZMW" });
const url = paymentLinkUrl(link.link_code); // open in a browser / WebView for the buyer

try {
  await client.transfers.create({ to_user_id, amount: 100, currency: "ZMW" }, "idempotency-key-1");
} catch (e) {
  if (e instanceof BMaGlassError) show(e.userMessage()); // plain language, safe to display
}
```

## Honest limits & security

- **Test keys are read-only** (no test-mode ledger): reads and
  webhook registration work; writes throw `test_mode_read_only`.
- **Currencies:** ZMW and USD only; anything else throws
  `unsupported_currency` client-side — no FX rate is ever invented.
- **API keys are secrets.** A `bmp_live_` key moves real money. In a
  consumer app, prefer calling your own backend with the key held
  server-side; ship a key in an app binary only for the key owner's
  own account use (e.g. the merchant's own device).

## Test

```bash
node sdk/react-native/test/sdk.test.mjs
```

(Node ≥ 22 runs the TypeScript sources via type stripping; 18 checks:
SHA-256/HMAC vs `node:crypto`, shared webhook KAT, stub-fetch client
behaviour, currency + test-mode guards.)
