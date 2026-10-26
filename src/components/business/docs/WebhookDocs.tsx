import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Truth pass (2026-10-26): documents the developer-api webhooks only —
// the events that really occur, the real signature scheme and the real
// delivery log. (The legacy merchant dispatch-webhook flow is separate
// and is not part of the public developer API.)
export function WebhookDocs() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Developer Webhooks</CardTitle>
        <CardDescription>Signed event notifications from the developer-api, with a delivery log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="font-medium mb-2">Events that really occur</p>
          <div className="flex flex-wrap gap-2">
            {["transaction.completed", "payment_link.created", "payment_link.paid", "webhook.test"].map((ev) => (
              <Badge key={ev} variant="secondary" className="font-mono">{ev}</Badge>
            ))}
          </div>
          <p className="text-muted-foreground mt-2">
            transaction.completed fires when a live API transfer settles; payment_link.created when a
            live API payment link is created; payment_link.paid when a payment link is paid (exactly
            once per settlement, with the link code, amount, currency and settlement transaction id);
            webhook.test when you send a test delivery.
          </p>
        </div>
        <div>
          <p className="font-medium mb-2">Registering an endpoint</p>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto">{`POST /webhooks  { "url": "https://your-site.com/hook", "events": ["transaction.completed"] }
→ 201 { "id": "…", "url": "…", "secret": "whsec_…" }   // secret shown exactly once`}</pre>
          <p className="text-muted-foreground">HTTPS URLs only. Endpoints can also be managed on the API page.</p>
        </div>
        <div>
          <p className="font-medium mb-2">Verifying a delivery</p>
          <p className="text-muted-foreground">
            Each delivery carries <code>X-BMaGlass-Signature: sha256=&lt;hex&gt;</code> — HMAC-SHA256 of the
            exact request body, keyed with your endpoint secret — plus <code>X-BMaGlass-Event</code> and
            <code> X-BMaGlass-Delivery</code> headers. Verify before trusting the payload; both SDKs ship a
            verification helper (<code>verifyWebhookSignature</code> / <code>verify_webhook_signature</code>).
          </p>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto">{`{ "id": "evt_…", "type": "transaction.completed",
  "created": "2026-10-26T00:00:00.000Z",
  "data": { "transaction_id": "…", "amount": 100, "currency": "ZMW" } }`}</pre>
        </div>
        <div>
          <p className="font-medium mb-2">Delivery log</p>
          <p className="text-muted-foreground">
            Every attempt is recorded (status, HTTP response, error) and readable via
            <code> GET /webhook-deliveries</code> or on the API page. Deliveries are attempted once per
            event today — there is no automatic retry schedule for developer webhooks yet, so return a
            2xx promptly and reconcile from the log.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
