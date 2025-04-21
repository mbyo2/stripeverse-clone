
import React from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Code } from "lucide-react";

export function WebhookDocs() {
  return (
    <div className="space-y-6">
      <Alert>
        <Code className="h-4 w-4 mr-2" />
        <AlertDescription>
          Webhooks allow you to receive real-time updates about events in your account.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Payload Structure</CardTitle>
          <CardDescription>
            All webhook events follow this standard format
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-secondary/20 p-4 rounded-md overflow-x-auto">
{`{
  "event_type": "payment_success | payment_failed | settlement | refund",
  "event_id": "unique-event-identifier",
  "timestamp": "2025-04-21T10:00:00Z",
  "business_id": "your-business-id",
  "data": {
    // Event specific data
  }
}`}
          </pre>
        </CardContent>
      </Card>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Payment Success Event</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-secondary/20 p-4 rounded-md overflow-x-auto">
{`{
  // Standard webhook fields...
  "data": {
    "transaction_id": "tx_123",
    "amount": 1000,
    "currency": "ZMW",
    "payment_method": "card|mobile_money",
    "customer_info": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Failed Event</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-secondary/20 p-4 rounded-md overflow-x-auto">
{`{
  // Standard webhook fields...
  "data": {
    "transaction_id": "tx_123",
    "amount": 1000,
    "currency": "ZMW",
    "payment_method": "card|mobile_money",
    "error": {
      "code": "insufficient_funds",
      "message": "The payment failed due to insufficient funds"
    }
  }
}`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Settlement Event</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-secondary/20 p-4 rounded-md overflow-x-auto">
{`{
  // Standard webhook fields...
  "data": {
    "settlement_id": "setl_123",
    "amount": 5000,
    "currency": "ZMW",
    "transactions": ["tx_123", "tx_124"],
    "period": {
      "start": "2025-04-20T00:00:00Z",
      "end": "2025-04-21T00:00:00Z"
    }
  }
}`}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Refund Event</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-secondary/20 p-4 rounded-md overflow-x-auto">
{`{
  // Standard webhook fields...
  "data": {
    "refund_id": "ref_123",
    "transaction_id": "tx_123",
    "amount": 1000,
    "currency": "ZMW",
    "reason": "customer_request",
    "status": "completed"
  }
}`}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
