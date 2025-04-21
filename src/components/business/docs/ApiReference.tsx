
import React from 'react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check } from "lucide-react";

export function ApiReference() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>API Reference</CardTitle>
        <CardDescription>Complete documentation of our payment API endpoints</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="rest" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="rest">REST API</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          </TabsList>
          
          <TabsContent value="rest" className="space-y-4">
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold mb-2">Authentication</h3>
              <p className="text-sm text-muted-foreground mb-2">
                All API requests require authentication using your API key in the header:
              </p>
              <pre className="bg-secondary/20 p-2 rounded text-sm mb-2">
                Authorization: Bearer YOUR_API_KEY
              </pre>
            </div>
            
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold mb-2">Endpoints</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Create Payment</p>
                  <pre className="bg-secondary/20 p-2 rounded text-sm">
                    POST /api/v1/payments
                  </pre>
                </div>
                <div>
                  <p className="text-sm font-medium">Get Payment Status</p>
                  <pre className="bg-secondary/20 p-2 rounded text-sm">
                    GET /api/v1/payments/:id
                  </pre>
                </div>
                <div>
                  <p className="text-sm font-medium">List Transactions</p>
                  <pre className="bg-secondary/20 p-2 rounded text-sm">
                    GET /api/v1/transactions
                  </pre>
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="webhooks" className="space-y-4">
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold mb-2">Webhook Events</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-sm">payment.success</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-sm">payment.failed</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-sm">refund.processed</span>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        
        <div className="mt-4">
          <Button variant="outline" className="w-full">
            View Full Documentation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
