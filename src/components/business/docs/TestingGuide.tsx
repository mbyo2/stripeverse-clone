
import React from 'react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, CreditCard, AlertCircle } from "lucide-react";

export function TestingGuide() {
  const testCards = [
    {
      type: "Success",
      number: "4242 4242 4242 4242",
      description: "Always succeeds"
    },
    {
      type: "Decline",
      number: "4000 0000 0000 0002",
      description: "Always declined"
    },
    {
      type: "Authentication Required",
      number: "4000 0027 6000 3184",
      description: "Requires 3D Secure"
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Testing Guide</CardTitle>
        <CardDescription>Learn how to test our payment integration</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <h3 className="font-medium mb-2">Test Environment</h3>
            <div className="bg-secondary/20 p-3 rounded-lg text-sm">
              <p>Base URL: <code>https://api.test.bmaglass.com</code></p>
              <p className="mt-1">Test API Key: <code>test_sk_123...</code></p>
            </div>
          </div>

          <div>
            <h3 className="font-medium mb-2">Test Cards</h3>
            <div className="space-y-3">
              {testCards.map((card) => (
                <div key={card.number} className="flex items-start gap-3 p-3 border rounded-lg">
                  <CreditCard className="h-5 w-5 mt-1 text-primary" />
                  <div>
                    <p className="font-medium">{card.type}</p>
                    <code className="text-sm">{card.number}</code>
                    <p className="text-sm text-muted-foreground mt-1">{card.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-medium">Testing Tips</h3>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Check className="h-4 w-4 mt-1 text-green-500" />
                <p className="text-sm">Use any future expiry date for test cards</p>
              </div>
              <div className="flex items-start gap-2">
                <Check className="h-4 w-4 mt-1 text-green-500" />
                <p className="text-sm">Any 3 digits can be used for CVC</p>
              </div>
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-1 text-amber-500" />
                <p className="text-sm">Test transactions will appear in your dashboard but won't be processed</p>
              </div>
            </div>
          </div>

          <Button variant="outline" className="w-full">
            View Full Testing Documentation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
