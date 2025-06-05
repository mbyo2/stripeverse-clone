
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, CreditCard, AlertCircle, Settings } from "lucide-react";

interface TestCard {
  type: string;
  number: string;
  description: string;
  currency?: string;
  amount?: number;
}

interface TestEnvironment {
  name: string;
  baseUrl: string;
  apiKey: string;
  description: string;
}

export function TestingGuide() {
  const [environments, setEnvironments] = useState<TestEnvironment[]>([
    {
      name: "Sandbox",
      baseUrl: "https://api.sandbox.bmaglass.com",
      apiKey: "test_sk_sandbox_123...",
      description: "Full-featured testing environment"
    },
    {
      name: "Staging",
      baseUrl: "https://api.staging.bmaglass.com",
      apiKey: "test_sk_staging_456...",
      description: "Pre-production environment"
    }
  ]);

  const [selectedEnvironment, setSelectedEnvironment] = useState(0);
  const [testCards, setTestCards] = useState<TestCard[]>([
    {
      type: "Success",
      number: "4242 4242 4242 4242",
      description: "Always succeeds",
      currency: "ZMW",
      amount: 1000
    },
    {
      type: "Decline",
      number: "4000 0000 0000 0002",
      description: "Always declined",
      currency: "ZMW"
    },
    {
      type: "Authentication Required",
      number: "4000 0027 6000 3184",
      description: "Requires 3D Secure",
      currency: "ZMW"
    },
    {
      type: "Insufficient Funds",
      number: "4000 0000 0000 9995",
      description: "Insufficient funds error",
      currency: "ZMW"
    },
    {
      type: "Network Error",
      number: "4000 0000 0000 0119",
      description: "Network processing error",
      currency: "ZMW"
    }
  ]);

  const [testConfig, setTestConfig] = useState({
    webhookUrl: "https://your-app.com/webhooks/payment",
    timeoutSeconds: 30,
    retryAttempts: 3,
    enableLogging: true
  });

  const updateTestCard = (index: number, updates: Partial<TestCard>) => {
    setTestCards(prev => prev.map((card, i) => 
      i === index ? { ...card, ...updates } : card
    ));
  };

  const addTestCard = () => {
    setTestCards(prev => [...prev, {
      type: "Custom",
      number: "4000 0000 0000 0000",
      description: "Custom test scenario",
      currency: "ZMW"
    }]);
  };

  const generateTestPayload = (card: TestCard) => ({
    amount: card.amount || 1000,
    currency: card.currency || "ZMW",
    payment_method: {
      type: "card",
      card: {
        number: card.number.replace(/\s/g, ''),
        exp_month: 12,
        exp_year: new Date().getFullYear() + 2,
        cvc: "123"
      }
    },
    metadata: {
      test_scenario: card.type.toLowerCase().replace(/\s/g, '_')
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Testing Guide</CardTitle>
        <CardDescription>Configure and test payment integration</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Environment Selection */}
          <div>
            <h3 className="font-medium mb-2 flex items-center">
              <Settings className="h-4 w-4 mr-2" />
              Test Environment
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {environments.map((env, index) => (
                <div 
                  key={env.name}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedEnvironment === index 
                      ? 'border-primary bg-primary/5' 
                      : 'hover:border-muted-foreground/50'
                  }`}
                  onClick={() => setSelectedEnvironment(index)}
                >
                  <h4 className="font-medium">{env.name}</h4>
                  <p className="text-xs text-muted-foreground">{env.description}</p>
                  <div className="mt-2">
                    <code className="text-xs bg-secondary/20 px-2 py-1 rounded block">
                      {env.baseUrl}
                    </code>
                    <code className="text-xs bg-secondary/20 px-2 py-1 rounded block mt-1">
                      {env.apiKey}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Test Cards */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Test Cards</h3>
              <Button variant="outline" size="sm" onClick={addTestCard}>
                Add Custom Card
              </Button>
            </div>
            <div className="space-y-3">
              {testCards.map((card, index) => (
                <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
                  <CreditCard className="h-5 w-5 mt-1 text-primary" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="text"
                        value={card.type}
                        onChange={(e) => updateTestCard(index, { type: e.target.value })}
                        className="font-medium bg-transparent border-none p-0 focus:outline-none focus:ring-0"
                      />
                      <span className="text-xs bg-secondary px-2 py-1 rounded">
                        {card.currency || 'ZMW'}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={card.number}
                      onChange={(e) => updateTestCard(index, { number: e.target.value })}
                      className="text-sm font-mono bg-transparent border-none p-0 focus:outline-none focus:ring-0 w-full"
                    />
                    <input
                      type="text"
                      value={card.description}
                      onChange={(e) => updateTestCard(index, { description: e.target.value })}
                      className="text-sm text-muted-foreground bg-transparent border-none p-0 focus:outline-none focus:ring-0 w-full mt-1"
                    />
                    <details className="mt-2">
                      <summary className="text-xs text-blue-500 cursor-pointer">View test payload</summary>
                      <pre className="text-xs bg-secondary/20 p-2 rounded mt-1 overflow-x-auto">
                        {JSON.stringify(generateTestPayload(card), null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Testing Configuration */}
          <div>
            <h3 className="font-medium mb-2">Test Configuration</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Webhook URL</label>
                <input
                  type="url"
                  value={testConfig.webhookUrl}
                  onChange={(e) => setTestConfig(prev => ({ ...prev, webhookUrl: e.target.value }))}
                  className="w-full text-xs border rounded px-2 py-1 mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Timeout (seconds)</label>
                <input
                  type="number"
                  value={testConfig.timeoutSeconds}
                  onChange={(e) => setTestConfig(prev => ({ ...prev, timeoutSeconds: parseInt(e.target.value) }))}
                  className="w-full text-xs border rounded px-2 py-1 mt-1"
                />
              </div>
            </div>
          </div>

          {/* Testing Tips */}
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
                <p className="text-sm">
                  Test transactions appear in dashboard but won't be processed in {environments[selectedEnvironment].name}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-1 text-amber-500" />
                <p className="text-sm">
                  Webhook events are sent to: {testConfig.webhookUrl}
                </p>
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
