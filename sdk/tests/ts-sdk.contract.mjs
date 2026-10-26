// Contract tests for @bmaglass/sdk against a faithful local harness that
// implements the developer-api contract (same routes, headers, error
// shapes as supabase/functions/developer-api). Run: npm test in
// sdk/typescript (builds first), or node sdk/tests/ts-sdk.contract.mjs after
// building sdk/typescript.
import assert from "node:assert";
import { createServer } from "node:http";
import { BMaGlass, BMaGlassError, verifyWebhookSignature, parseWebhookEvent } from "../typescript/dist/index.js";

const seen = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ method: req.method, url: req.url, key: req.headers["x-api-key"], idem: req.headers["idempotency-key"], body });
    const reply = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.headers["x-api-key"] !== "bmp_test_contract") return reply(401, { error: "invalid_api_key", message: "nope" });
    if (req.url === "/wallets") return reply(200, { data: [{ id: "w1", currency: "ZMW", balance: 42, status: "active", created_at: "x", updated_at: "y" }], mode: "test" });
    if (req.url?.startsWith("/transactions")) return reply(200, { data: [], mode: "test" });
    if (req.url === "/transfers") return reply(403, { error: "test_mode_read_only", message: "Test keys are read-only" });
    if (req.url === "/payment-links" && req.method === "GET") return reply(200, { data: [], mode: "test" });
    if (req.url === "/bitcoin/balance") return reply(200, { data: [{ asset: "BTC", balance_sats: 1000, available_sats: 1000, updated_at: "z" }], mode: "test" });
    if (req.url === "/webhooks" && req.method === "POST") return reply(201, { data: { id: "wh1", url: "https://example.com/hook", events: ["webhook.test"], is_active: true, created_at: "t", secret: "whsec_testsecret" }, mode: "test" });
    return reply(404, { error: "not_found", message: "no route" });
  });
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const client = new BMaGlass({ apiKey: "bmp_test_contract", baseUrl: base });
assert.equal(client.mode, "test");
assert.equal(new BMaGlass({ apiKey: "bmp_live_x", baseUrl: base }).mode, "live");
assert.throws(() => new BMaGlass({ apiKey: "sk_live_nope" }), BMaGlassError);

const wallets = await client.wallets.list();
assert.equal(wallets[0].balance, 42);
assert.equal(seen.at(-1).key, "bmp_test_contract");
await client.transactions.list(5);
assert.ok(seen.at(-1).url.includes("limit=5"));
await assert.rejects(() => client.transfers.create({ to_user_id: "u2", amount: 10 }, "idem-1"),
  (e) => e instanceof BMaGlassError && e.status === 403 && e.code === "test_mode_read_only");
assert.equal(seen.at(-1).idem, "idem-1");
assert.deepEqual(await client.paymentLinks.list(), []);
assert.equal((await client.bitcoin.balance())[0].balance_sats, 1000);
const hook = await client.webhooks.create({ url: "https://example.com/hook" });
assert.equal(hook.secret, "whsec_testsecret");

// Webhook verification: known-answer vector (HMAC-SHA256, computed independently).
const raw = '{"id":"evt_1","type":"webhook.test","created":"2026-10-26T00:00:00.000Z","data":{"ping":true}}';
const sig = "sha256=ff522c97ada5bfd4f6c09a0457823f89546896708e8e1f5bbb72d2ad59d68535";
assert.equal(verifyWebhookSignature(raw, sig, "whsec_testsecret"), true);
assert.equal(verifyWebhookSignature(raw, sig, "whsec_wrong"), false);
assert.equal(verifyWebhookSignature(raw + " ", sig, "whsec_testsecret"), false);
assert.equal(parseWebhookEvent(raw, sig, "whsec_testsecret").type, "webhook.test");
assert.equal(parseWebhookEvent(raw, "sha256=deadbeef", "whsec_testsecret"), null);

server.close();
console.log("TS SDK contract tests: ALL PASS");
