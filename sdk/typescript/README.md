# @bmaglass/sdk

Typed TypeScript/JavaScript client for the BMaGlass Pay Developer API.

```ts
import { BMaGlass, verifyWebhookSignature } from "@bmaglass/sdk";

const client = new BMaGlass({ apiKey: "bmp_test_…" }); // test keys are read-only
const wallets = await client.wallets.list();
const links = await client.paymentLinks.list();
const quote = await client.bitcoin.quote({ side: "buy", amount_zmw: 100 });

// Live keys only:
await client.transfers.create({ to_user_id: "…", amount: 100 }, "idempotency-key");

// In your webhook handler (raw body!):
verifyWebhookSignature(rawBody, req.headers["x-bmglass-signature"], webhookSecret);
```

Build: `npm install && npm run build` · Tests: `npm test` (contract tests in `../tests/`).
Errors are `BMaGlassError` with `status` and `code` (e.g. `test_mode_read_only`).
