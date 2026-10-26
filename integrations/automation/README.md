# BMaGlass Pay × Zapier / Make — webhook-first automation pack

No app-store listing exists (or is claimed) for BMaGlass Pay on
Zapier or Make. You don't need one: the BMaGlass developer API is
webhook- and REST-first, and both platforms' **native** webhook/HTTP
modules cover the useful automations today.

## What events exist (truthfully)

BMaGlass webhooks fire for:

| Event | When | Payload `data` |
|---|---|---|
| `transaction.completed` | a transfer made **via the developer API** completes | `{transaction_id, amount, currency, to_user_id}` |
| `payment_link.created` | a payment link is created (app or API) | the link row (`id`, `link_code`, `title`, `amount`, `currency`, `status`) |
| `webhook.test` | you press "send test" | `{ping: true}` |

Example payloads: `examples/*.json` in this folder.

**Not available today:** a webhook when a buyer *pays* a payment
link. If an automation must react to a customer paying you, poll
`GET /payment-links` (Zapier Schedule → Webhooks GET, or a Make
scenario on a timer) and watch `payment_count` / `total_collected`
for your link — that is the same reconciliation pattern the shop
connectors use.

## Zapier recipes

### Trigger: "a BMaGlass transfer completed"
1. Trigger: **Webhooks by Zapier → Catch Hook**. Copy the hook URL.
2. In BMaGlass Pay → **Developers/Webhooks**, register that URL
   (or `POST /webhooks` with your API key). Save the signing secret
   shown once.
3. Back in Zapier, use **Send test event** from BMaGlass (delivers
   `webhook.test`) to teach the hook the payload shape, then build
   actions (Sheets, Gmail, Slack…) from the real
   `transaction.completed` fields above.

### Action: "create a payment link"
1. Action: **Webhooks by Zapier → POST**.
2. URL: `https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api/payment-links`
3. Headers: `X-Api-Key: bmp_live_...` (use a key scoped to
   `payment_links:write` only) and `Content-Type: application/json`.
4. Body (JSON): `{"title": "...", "amount": 250, "currency": "ZMW"}`
   — currencies are ZMW/USD only.
5. The response contains `link_code`; the buyer URL is
   `https://bmaglasspay.online/pay/<link_code>` — chain a Formatter
   step to build it and pass it to your next action (email, SMS…).
6. **Live keys only**: a test key answers `403 test_mode_read_only`
   — by design, since there is no test-mode ledger.

### Signature verification (honest note)
Zapier's native Catch Hook can't verify our HMAC signature. The
events carry no secrets and move no money, so the risk is nuisance
triggers, not theft. For automations that *act* on money, re-read
the truth from the API (a Webhooks GET step on `/transactions` or
`/payment-links`) before acting — or run your own tiny endpoint
(any SDK in `sdk/` verifies `X-BMaGlass-Signature` in one call)
and point the webhook there.

## Make recipes

- **Trigger:** a scenario starting with **Webhooks → Custom webhook**;
  register its URL in BMaGlass exactly as above.
- **Action:** **HTTP → Make a request** with the same URL, headers
  and JSON body as the Zapier POST recipe.
- **Polling:** **HTTP → Make a request** `GET .../payment-links`
  with your key header, on a schedule, filtered on
  `payment_count` changes (store the last seen count in a Data
  store module).

## Zapier Platform app definition (DRAFT)

`zapier/triggers-and-creates.json` in this folder is a **draft,
unsubmitted** Zapier Platform-style definition of the trigger and
create above, kept for a future formal submission. It is not
published, not reviewed, and not needed for the recipes — the
native modules are the supported path today.
