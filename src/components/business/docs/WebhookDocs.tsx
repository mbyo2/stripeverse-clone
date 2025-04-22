
import React from "react";
import { Shield, Webhook, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WebhookPayload } from "@/utils/webhookDelivery";

export function WebhookDocs() {
  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-2">Webhook Integration</h3>
        <p className="text-sm text-muted-foreground">
          Use webhooks to receive real-time notifications about events in your BMaGlass Pay account.
          Our webhooks send HTTP POST requests to your endpoint whenever specific events occur.
        </p>
      </div>
      
      <Tabs defaultValue="overview">
        <TabsList className="w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payload">Webhook Payload</TabsTrigger>
          <TabsTrigger value="events">Event Types</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="p-4 border rounded-md mt-4">
          <div className="space-y-4">
            <h4 className="font-medium">Getting Started with Webhooks</h4>
            <p className="text-sm">
              To start receiving webhook notifications, you'll need to:
            </p>
            <ol className="list-decimal pl-5 text-sm space-y-2">
              <li>Create an endpoint on your server to receive webhook POST requests</li>
              <li>Configure the webhook URL in your business dashboard</li>
              <li>Select which events you want to subscribe to</li>
              <li>Implement proper validation of incoming webhook requests</li>
            </ol>
            
            <div className="bg-blue-50 p-4 rounded-md">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" /> 
                <div>
                  <h5 className="font-medium text-blue-800 mb-1">Testing Webhooks</h5>
                  <p className="text-sm text-blue-700">
                    During development, you can use services like webhook.site or ngrok to receive and inspect webhooks.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="payload" className="p-4 border rounded-md mt-4">
          <div className="space-y-4">
            <h4 className="font-medium">Webhook Payload Structure</h4>
            <p className="text-sm">
              All webhook events follow the same JSON structure:
            </p>
            
            <pre className="bg-gray-50 p-4 rounded-md overflow-x-auto text-xs">
{`{
  "event_type": "payment.success",
  "event_id": "evt_123456789",
  "timestamp": "2023-04-22T14:30:45Z",
  "business_id": "bus_987654321",
  "data": {
    // Event specific data
  }
}`}
            </pre>
            
            <h5 className="font-medium mt-6">Payload Fields</h5>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="font-medium">event_type</p>
                <p className="text-muted-foreground">The type of event that occurred</p>
              </div>
              <div>
                <p className="font-medium">event_id</p>
                <p className="text-muted-foreground">Unique identifier for this event</p>
              </div>
              <div>
                <p className="font-medium">timestamp</p>
                <p className="text-muted-foreground">ISO timestamp when the event occurred</p>
              </div>
              <div>
                <p className="font-medium">business_id</p>
                <p className="text-muted-foreground">Your business account identifier</p>
              </div>
              <div className="col-span-1 md:col-span-2">
                <p className="font-medium">data</p>
                <p className="text-muted-foreground">Object containing the event-specific data</p>
              </div>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="events" className="p-4 border rounded-md mt-4">
          <div className="space-y-4">
            <h4 className="font-medium">Available Event Types</h4>
            <p className="text-sm">
              You can subscribe to the following event types:
            </p>
            
            <div className="space-y-4">
              <div className="border-b pb-4">
                <h5 className="font-medium">Payment Events</h5>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium">payment.success</p>
                    <p className="text-muted-foreground">A payment was successfully completed</p>
                  </div>
                  <div>
                    <p className="font-medium">payment.failed</p>
                    <p className="text-muted-foreground">A payment attempt failed</p>
                  </div>
                  <div>
                    <p className="font-medium">payment.pending</p>
                    <p className="text-muted-foreground">A payment is awaiting confirmation</p>
                  </div>
                  <div>
                    <p className="font-medium">payment.refunded</p>
                    <p className="text-muted-foreground">A payment was refunded</p>
                  </div>
                </div>
              </div>
              
              <div className="border-b pb-4">
                <h5 className="font-medium">Customer Events</h5>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium">customer.created</p>
                    <p className="text-muted-foreground">A new customer was created</p>
                  </div>
                  <div>
                    <p className="font-medium">customer.updated</p>
                    <p className="text-muted-foreground">A customer's information was updated</p>
                  </div>
                </div>
              </div>
              
              <div>
                <h5 className="font-medium">Dispute Events</h5>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium">dispute.created</p>
                    <p className="text-muted-foreground">A dispute was filed</p>
                  </div>
                  <div>
                    <p className="font-medium">dispute.resolved</p>
                    <p className="text-muted-foreground">A dispute was resolved</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="security" className="p-4 border rounded-md mt-4">
          <div className="space-y-4">
            <h4 className="font-medium">Securing Webhook Endpoints</h4>
            <p className="text-sm">
              To ensure webhook security, follow these best practices:
            </p>
            
            <div className="space-y-3 text-sm pl-5">
              <div className="relative">
                <div className="absolute left-0 -ml-5 flex h-5 w-5 items-center justify-center">
                  <Shield className="h-3 w-3 text-primary" />
                </div>
                <p>Use HTTPS for your webhook endpoint</p>
              </div>
              
              <div className="relative">
                <div className="absolute left-0 -ml-5 flex h-5 w-5 items-center justify-center">
                  <Shield className="h-3 w-3 text-primary" />
                </div>
                <p>Verify webhook signatures using your webhook secret</p>
              </div>
              
              <div className="relative">
                <div className="absolute left-0 -ml-5 flex h-5 w-5 items-center justify-center">
                  <Shield className="h-3 w-3 text-primary" />
                </div>
                <p>Set up IP address restrictions if possible</p>
              </div>
              
              <div className="relative">
                <div className="absolute left-0 -ml-5 flex h-5 w-5 items-center justify-center">
                  <Shield className="h-3 w-3 text-primary" />
                </div>
                <p>Validate the content and structure of each webhook</p>
              </div>
              
              <div className="relative">
                <div className="absolute left-0 -ml-5 flex h-5 w-5 items-center justify-center">
                  <Shield className="h-3 w-3 text-primary" />
                </div>
                <p>Implement proper error handling for webhook processing</p>
              </div>
            </div>
            
            <div className="mt-4">
              <h5 className="font-medium">Implementation Example</h5>
              <pre className="bg-gray-50 p-4 rounded-md overflow-x-auto text-xs mt-2">
{`// Example of verifying webhook signature
const crypto = require('crypto');

function verifyWebhook(payload, signature, webhookSecret) {
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const digest = hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(signature)
  );
}`}
              </pre>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      
      <div className="mt-4 text-right">
        <Button variant="outline" size="sm">
          View Sample Code
        </Button>
      </div>
    </div>
  );
}
