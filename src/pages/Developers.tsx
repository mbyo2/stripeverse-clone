import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Code2, Book, Webhook, CreditCard, Globe, Copy, Check, 
  ArrowRight, Zap, Shield, Terminal, Package, 
  ShoppingCart, Store, Blocks, Plug, Download, ExternalLink, Play
} from "lucide-react";
import { ApiPlayground } from "@/components/developers/ApiPlayground";
import { useToast } from "@/hooks/use-toast";

const CodeBlock = ({ code, language = "bash" }: { code: string; language?: string }) => {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast({ title: "Copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <pre className="bg-secondary/30 border rounded-lg p-4 overflow-x-auto text-sm font-mono text-foreground">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={copy}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
};

const EndpointRow = ({ method, path, description }: { method: string; path: string; description: string }) => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 border rounded-lg hover:bg-accent/30 transition-colors">
    <Badge variant={method === "GET" ? "secondary" : method === "POST" ? "default" : "outline"} className="w-fit font-mono text-xs">
      {method}
    </Badge>
    <code className="text-sm font-mono text-foreground flex-1">{path}</code>
    <span className="text-sm text-muted-foreground">{description}</span>
  </div>
);

const PlatformCard = ({ name, icon: Icon, description, status, installCmd, features }: {
  name: string;
  icon: React.ElementType;
  description: string;
  status: "stable" | "beta" | "coming-soon";
  installCmd?: string;
  features: string[];
}) => (
  <Card className="flex flex-col">
    <CardHeader>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">{name}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
        <Badge variant={status === "stable" ? "default" : status === "beta" ? "secondary" : "outline"}>
          {status === "coming-soon" ? "Coming Soon" : status === "beta" ? "Beta" : "Stable"}
        </Badge>
      </div>
    </CardHeader>
    <CardContent className="flex-1 flex flex-col justify-between gap-4">
      <ul className="space-y-1">
        {features.map((f, i) => (
          <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
            <Check className="h-3 w-3 text-primary flex-shrink-0" /> {f}
          </li>
        ))}
      </ul>
      {installCmd && (
        <CodeBlock code={installCmd} />
      )}
      <div className="flex gap-2 mt-auto">
        <Button variant="outline" size="sm" className="flex-1">
          <Book className="h-4 w-4 mr-1" /> Docs
        </Button>
        {status !== "coming-soon" && (
          <Button size="sm" className="flex-1">
            <Download className="h-4 w-4 mr-1" /> Install
          </Button>
        )}
      </div>
    </CardContent>
  </Card>
);

const Developers = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16">
        {/* Hero Section */}
        <section className="px-4 max-w-7xl mx-auto mb-16">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">Developer Portal</Badge>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Build with <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">BMaGlass Pay</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Accept payments in minutes. Our SDKs, plugins, and APIs make integration effortless — 
              whether you're building custom or using platforms like WordPress, Odoo, or Shopify.
            </p>
          </div>

          {/* Quick Start Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <Card className="border-primary/20 hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6 text-center">
                <div className="p-3 rounded-full bg-primary/10 w-fit mx-auto mb-3">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">Quick Start</h3>
                <p className="text-sm text-muted-foreground">Accept your first payment in under 5 minutes</p>
              </CardContent>
            </Card>
            <Card className="border-primary/20 hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6 text-center">
                <div className="p-3 rounded-full bg-primary/10 w-fit mx-auto mb-3">
                  <Plug className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">No-Code Plugins</h3>
                <p className="text-sm text-muted-foreground">WordPress, Odoo, WooCommerce — zero code required</p>
              </CardContent>
            </Card>
            <Card className="border-primary/20 hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="pt-6 text-center">
                <div className="p-3 rounded-full bg-primary/10 w-fit mx-auto mb-3">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">Enterprise Ready</h3>
                <p className="text-sm text-muted-foreground">PCI DSS compliant with webhook signature verification</p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Main Docs Area */}
        <section className="px-4 max-w-7xl mx-auto">
          <Tabs defaultValue="quickstart" className="space-y-8">
            <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
              <TabsTrigger value="quickstart" className="flex items-center gap-1.5">
                <Zap className="h-4 w-4" /> Quick Start
              </TabsTrigger>
              <TabsTrigger value="api" className="flex items-center gap-1.5">
                <Terminal className="h-4 w-4" /> API Reference
              </TabsTrigger>
              <TabsTrigger value="sdks" className="flex items-center gap-1.5">
                <Package className="h-4 w-4" /> SDKs
              </TabsTrigger>
              <TabsTrigger value="plugins" className="flex items-center gap-1.5">
                <Blocks className="h-4 w-4" /> Plugins & Modules
              </TabsTrigger>
              <TabsTrigger value="webhooks" className="flex items-center gap-1.5">
                <Webhook className="h-4 w-4" /> Webhooks
              </TabsTrigger>
              <TabsTrigger value="testing" className="flex items-center gap-1.5">
                <CreditCard className="h-4 w-4" /> Testing
              </TabsTrigger>
              <TabsTrigger value="playground" className="flex items-center gap-1.5">
                <Play className="h-4 w-4" /> Playground
              </TabsTrigger>
            </TabsList>

            {/* QUICK START */}
            <TabsContent value="quickstart" className="space-y-8">
              <Card>
                <CardHeader>
                  <CardTitle>Get Started in 3 Steps</CardTitle>
                  <CardDescription>Start accepting payments on your website or app in minutes</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  {/* Step 1 */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">1</div>
                      <h3 className="font-semibold text-lg">Install the SDK</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">Choose your preferred package manager:</p>
                    <div className="space-y-2">
                      <CodeBlock code="npm install @bmaglass/payments-js" />
                      <CodeBlock code="yarn add @bmaglass/payments-js" />
                      <CodeBlock code="pip install bmaglass-payments" />
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">2</div>
                      <h3 className="font-semibold text-lg">Initialize with your API Key</h3>
                    </div>
                    <CodeBlock language="javascript" code={`import BMaGlass from '@bmaglass/payments-js';

const bmaglass = new BMaGlass({
  apiKey: 'pk_live_YOUR_API_KEY',
  environment: 'production' // or 'sandbox'
});`} />
                  </div>

                  {/* Step 3 */}
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">3</div>
                      <h3 className="font-semibold text-lg">Create a Payment</h3>
                    </div>
                    <CodeBlock language="javascript" code={`const payment = await bmaglass.payments.create({
  amount: 150.00,
  currency: 'ZMW',
  payment_method: 'mobile_money',
  customer: {
    phone: '+260971234567',
    name: 'John Banda'
  },
  description: 'Order #1234',
  callback_url: 'https://yoursite.com/webhook'
});

console.log(payment.id);       // "pay_abc123..."
console.log(payment.status);   // "pending"
console.log(payment.checkout_url); // redirect user here`} />
                  </div>

                  <div className="p-4 bg-accent/50 rounded-lg border border-accent">
                    <p className="text-sm font-medium mb-1">💡 Using a CMS or e-commerce platform?</p>
                    <p className="text-sm text-muted-foreground">
                      Skip the code — install our <button className="text-primary underline" onClick={() => document.querySelector('[data-value="plugins"]')?.dispatchEvent(new Event('click'))}>ready-made plugins</button> for WordPress, WooCommerce, Odoo, Shopify, and more.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* API REFERENCE */}
            <TabsContent value="api" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Authentication</CardTitle>
                  <CardDescription>All API requests require Bearer token authentication</CardDescription>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={`curl -X POST https://api.bmaglasspay.com/v1/payments \\
  -H "Authorization: Bearer pk_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json"`} />
                  <p className="text-sm text-muted-foreground mt-3">
                    Use <code className="bg-secondary/30 px-1.5 py-0.5 rounded">pk_test_</code> keys in sandbox and <code className="bg-secondary/30 px-1.5 py-0.5 rounded">pk_live_</code> keys in production.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payments</CardTitle>
                  <CardDescription>Create, retrieve, and manage payments</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <EndpointRow method="POST" path="/v1/payments" description="Create a payment" />
                  <EndpointRow method="GET" path="/v1/payments/:id" description="Get payment details" />
                  <EndpointRow method="GET" path="/v1/payments" description="List all payments" />
                  <EndpointRow method="POST" path="/v1/payments/:id/refund" description="Refund a payment" />
                  <EndpointRow method="POST" path="/v1/payments/:id/capture" description="Capture authorized payment" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Transfers</CardTitle>
                  <CardDescription>Send money to bank accounts or mobile wallets</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <EndpointRow method="POST" path="/v1/transfers" description="Create a transfer" />
                  <EndpointRow method="GET" path="/v1/transfers/:id" description="Get transfer status" />
                  <EndpointRow method="GET" path="/v1/transfers" description="List transfers" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Customers</CardTitle>
                  <CardDescription>Manage customer records and saved payment methods</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <EndpointRow method="POST" path="/v1/customers" description="Create a customer" />
                  <EndpointRow method="GET" path="/v1/customers/:id" description="Retrieve customer" />
                  <EndpointRow method="PUT" path="/v1/customers/:id" description="Update customer" />
                  <EndpointRow method="GET" path="/v1/customers/:id/transactions" description="Customer transactions" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Virtual Cards</CardTitle>
                  <CardDescription>Issue and manage virtual payment cards</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <EndpointRow method="POST" path="/v1/cards" description="Create virtual card" />
                  <EndpointRow method="GET" path="/v1/cards/:id" description="Get card details" />
                  <EndpointRow method="POST" path="/v1/cards/:id/fund" description="Fund a card" />
                  <EndpointRow method="POST" path="/v1/cards/:id/freeze" description="Freeze/unfreeze card" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Subscriptions</CardTitle>
                  <CardDescription>Recurring billing and subscription management</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <EndpointRow method="POST" path="/v1/subscriptions" description="Create subscription" />
                  <EndpointRow method="GET" path="/v1/subscriptions/:id" description="Get subscription" />
                  <EndpointRow method="POST" path="/v1/subscriptions/:id/cancel" description="Cancel subscription" />
                  <EndpointRow method="POST" path="/v1/plans" description="Create billing plan" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Payment Methods</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                      { method: "mobile_money", label: "Mobile Money", providers: "MTN, Airtel, Zamtel" },
                      { method: "card", label: "Card Payments", providers: "Visa, Mastercard" },
                      { method: "bank_transfer", label: "Bank Transfer", providers: "All Zambian banks" },
                      { method: "ussd", label: "USSD", providers: "Feature phone support" },
                      { method: "bitcoin", label: "Bitcoin", providers: "Lightning Network" },
                      { method: "paypal", label: "PayPal", providers: "International payments" },
                    ].map((pm) => (
                      <div key={pm.method} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">{pm.label}</span>
                          <code className="text-xs bg-secondary/30 px-1.5 py-0.5 rounded">{pm.method}</code>
                        </div>
                        <p className="text-xs text-muted-foreground">{pm.providers}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Response Codes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {[
                      { code: "200", desc: "Success" },
                      { code: "201", desc: "Created" },
                      { code: "400", desc: "Bad Request — invalid parameters" },
                      { code: "401", desc: "Unauthorized — invalid or missing API key" },
                      { code: "403", desc: "Forbidden — insufficient permissions" },
                      { code: "404", desc: "Not Found" },
                      { code: "409", desc: "Conflict — duplicate idempotency key" },
                      { code: "422", desc: "Unprocessable — validation failed" },
                      { code: "429", desc: "Rate Limited — too many requests" },
                      { code: "500", desc: "Server Error" },
                    ].map((r) => (
                      <div key={r.code} className="flex items-center gap-3 p-2 rounded hover:bg-accent/30">
                        <Badge variant={r.code.startsWith("2") ? "default" : r.code.startsWith("4") ? "secondary" : "destructive"} className="font-mono w-12 justify-center">
                          {r.code}
                        </Badge>
                        <span className="text-muted-foreground">{r.desc}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* SDKs */}
            <TabsContent value="sdks" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  {
                    lang: "JavaScript / Node.js",
                    version: "v2.1.0",
                    install: "npm install @bmaglass/payments-js",
                    example: `const bmaglass = require('@bmaglass/payments-js');
const client = new bmaglass('pk_live_...');

const payment = await client.payments.create({
  amount: 500,
  currency: 'ZMW',
  payment_method: 'mobile_money',
  customer: { phone: '+260971234567' }
});`,
                  },
                  {
                    lang: "Python",
                    version: "v1.8.0",
                    install: "pip install bmaglass-payments",
                    example: `import bmaglass

client = bmaglass.Client(api_key="pk_live_...")

payment = client.payments.create(
    amount=500,
    currency="ZMW",
    payment_method="mobile_money",
    customer={"phone": "+260971234567"}
)`,
                  },
                  {
                    lang: "PHP",
                    version: "v1.5.0",
                    install: "composer require bmaglass/payments-php",
                    example: `use BMaGlass\\Payments\\Client;

$client = new Client('pk_live_...');

$payment = $client->payments->create([
    'amount' => 500,
    'currency' => 'ZMW',
    'payment_method' => 'mobile_money',
    'customer' => ['phone' => '+260971234567']
]);`,
                  },
                  {
                    lang: "Go",
                    version: "v1.2.0",
                    install: "go get github.com/bmaglass/payments-go",
                    example: `import bmaglass "github.com/bmaglass/payments-go"

client := bmaglass.NewClient("pk_live_...")

payment, err := client.Payments.Create(&bmaglass.PaymentParams{
    Amount:        500,
    Currency:      "ZMW",
    PaymentMethod: "mobile_money",
    Customer:      &bmaglass.Customer{Phone: "+260971234567"},
})`,
                  },
                ].map((sdk) => (
                  <Card key={sdk.lang}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{sdk.lang}</CardTitle>
                        <Badge variant="outline">{sdk.version}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <CodeBlock code={sdk.install} />
                      <details>
                        <summary className="text-sm text-primary cursor-pointer font-medium">View Example</summary>
                        <div className="mt-2">
                          <CodeBlock code={sdk.example} language={sdk.lang.toLowerCase()} />
                        </div>
                      </details>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Frontend Drop-in UI</CardTitle>
                  <CardDescription>Embed a pre-built payment form — no backend required</CardDescription>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={`<!-- Add to your HTML -->
<script src="https://js.bmaglasspay.com/v2/checkout.js"></script>

<div id="bmaglass-checkout"></div>

<script>
  BMaGlassCheckout.init({
    publicKey: 'pk_live_YOUR_KEY',
    amount: 150.00,
    currency: 'ZMW',
    onSuccess: (payment) => {
      console.log('Payment successful:', payment.id);
    },
    onError: (error) => {
      console.error('Payment failed:', error.message);
    }
  });
</script>`} />
                </CardContent>
              </Card>
            </TabsContent>

            {/* PLUGINS & MODULES */}
            <TabsContent value="plugins" className="space-y-8">
              <div className="text-center mb-4">
                <h2 className="text-2xl font-bold mb-2">Platform Integrations</h2>
                <p className="text-muted-foreground">Install once, accept payments forever. No coding required.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <PlatformCard
                  name="WordPress"
                  icon={Globe}
                  description="Payment gateway for WordPress sites"
                  status="stable"
                  installCmd="Upload bmaglass-pay.zip via Plugins → Add New"
                  features={[
                    "One-click install from WordPress admin",
                    "Donation & payment forms via shortcode",
                    "Gutenberg block for inline checkout",
                    "Supports Mobile Money, Cards & USSD",
                  ]}
                />
                <PlatformCard
                  name="WooCommerce"
                  icon={ShoppingCart}
                  description="Full checkout integration for WooCommerce"
                  status="stable"
                  installCmd="Upload bmaglass-woocommerce.zip via Plugins → Add New"
                  features={[
                    "Checkout gateway with all payment methods",
                    "Automatic order status updates via webhook",
                    "Multi-currency with ZMW as default",
                    "Refunds directly from WooCommerce admin",
                    "Subscriptions & recurring payments",
                  ]}
                />
                <PlatformCard
                  name="Odoo"
                  icon={Blocks}
                  description="Payment acquirer module for Odoo ERP"
                  status="stable"
                  installCmd="odoo-bin -i bmaglass_payment"
                  features={[
                    "Odoo 16 & 17 compatible",
                    "Payment acquirer with tokenization",
                    "POS integration for in-store payments",
                    "Invoice payment links via Mobile Money",
                    "Automatic journal entries & reconciliation",
                  ]}
                />
                <PlatformCard
                  name="Shopify"
                  icon={Store}
                  description="Shopify payment app"
                  status="beta"
                  features={[
                    "Shopify Payments API integration",
                    "Mobile Money at Shopify checkout",
                    "Automatic order fulfillment triggers",
                    "Multi-currency support",
                  ]}
                />
                <PlatformCard
                  name="PrestaShop"
                  icon={ShoppingCart}
                  description="Payment module for PrestaShop"
                  status="stable"
                  installCmd="Upload bmaglass_prestashop.zip via Modules → Upload"
                  features={[
                    "PrestaShop 1.7+ & 8.x compatible",
                    "Embedded checkout in order flow",
                    "Multi-shop support",
                    "Automatic refund processing",
                  ]}
                />
                <PlatformCard
                  name="Magento"
                  icon={ShoppingCart}
                  description="Adobe Commerce / Magento 2 extension"
                  status="coming-soon"
                  features={[
                    "Magento 2.4+ compatible",
                    "Vault payment tokenization",
                    "Admin panel transaction management",
                    "GraphQL & REST API support",
                  ]}
                />
                <PlatformCard
                  name="Laravel"
                  icon={Code2}
                  description="First-party PHP package for Laravel"
                  status="stable"
                  installCmd="composer require bmaglass/laravel-payments"
                  features={[
                    "Cashier-style API for subscriptions",
                    "Blade components for checkout forms",
                    "Webhook handling with signature verification",
                    "Artisan commands for testing & setup",
                  ]}
                />
                <PlatformCard
                  name="Django"
                  icon={Code2}
                  description="Django app for Python web projects"
                  status="beta"
                  installCmd="pip install django-bmaglass"
                  features={[
                    "Django 4.2+ & 5.x support",
                    "Model mixins for payable objects",
                    "Admin integration for transaction viewing",
                    "Celery task for async webhook processing",
                  ]}
                />
                <PlatformCard
                  name="React / Next.js"
                  icon={Code2}
                  description="React components and hooks"
                  status="stable"
                  installCmd="npm install @bmaglass/react"
                  features={[
                    "<PaymentForm /> drop-in component",
                    "usePayment() hook for custom UIs",
                    "Server-side support for Next.js",
                    "TypeScript definitions included",
                  ]}
                />
              </div>

              {/* Integration comparison */}
              <Card>
                <CardHeader>
                  <CardTitle>Choose Your Integration</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 pr-4">Feature</th>
                          <th className="text-center py-3 px-4">REST API</th>
                          <th className="text-center py-3 px-4">SDK</th>
                          <th className="text-center py-3 px-4">Plugin</th>
                          <th className="text-center py-3 px-4">Drop-in UI</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {[
                          ["Coding required", "Full", "Minimal", "None", "HTML only"],
                          ["Setup time", "1-2 days", "30 min", "5 min", "10 min"],
                          ["Customization", "Full", "Full", "Limited", "Theme only"],
                          ["PCI compliance", "You handle", "SDK handles", "Plugin handles", "We handle"],
                          ["Webhook support", "Manual", "Built-in", "Automatic", "Automatic"],
                          ["Mobile Money", "✓", "✓", "✓", "✓"],
                          ["Card payments", "✓", "✓", "✓", "✓"],
                          ["USSD", "✓", "✓", "✓", "—"],
                          ["Bitcoin", "✓", "✓", "—", "—"],
                        ].map(([feature, ...values], i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2.5 pr-4 font-medium text-foreground">{feature}</td>
                            {values.map((v, j) => (
                              <td key={j} className="text-center py-2.5 px-4">{v}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* WEBHOOKS */}
            <TabsContent value="webhooks" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Webhook Events</CardTitle>
                  <CardDescription>Receive real-time notifications when events occur in your account</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    {[
                      { category: "Payments", events: ["payment.created", "payment.completed", "payment.failed", "payment.refunded", "payment.expired"] },
                      { category: "Transfers", events: ["transfer.created", "transfer.completed", "transfer.failed"] },
                      { category: "Customers", events: ["customer.created", "customer.updated"] },
                      { category: "Disputes", events: ["dispute.created", "dispute.resolved", "dispute.escalated"] },
                      { category: "Subscriptions", events: ["subscription.created", "subscription.renewed", "subscription.cancelled", "subscription.payment_failed"] },
                    ].map((group) => (
                      <div key={group.category}>
                        <h4 className="font-medium mb-2">{group.category}</h4>
                        <div className="flex flex-wrap gap-2">
                          {group.events.map((e) => (
                            <Badge key={e} variant="outline" className="font-mono text-xs">{e}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Webhook Payload</CardTitle>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={`{
  "event_type": "payment.completed",
  "event_id": "evt_abc123def456",
  "timestamp": "2026-03-07T14:30:45Z",
  "api_version": "2026-01-01",
  "data": {
    "id": "pay_xyz789",
    "amount": 150.00,
    "currency": "ZMW",
    "status": "completed",
    "payment_method": "mobile_money",
    "customer": {
      "phone": "+260971234567",
      "name": "John Banda"
    },
    "metadata": {
      "order_id": "1234"
    }
  }
}`} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Signature Verification</CardTitle>
                  <CardDescription>Always verify webhook signatures to prevent spoofing</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CodeBlock code={`// Node.js example
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(payload, 'utf8').digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(digest, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

// In your webhook handler
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-bmaglass-signature'];
  const isValid = verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    process.env.BMAGLASS_WEBHOOK_SECRET
  );
  
  if (!isValid) return res.status(401).send('Invalid signature');
  
  // Process the event
  const event = req.body;
  switch (event.event_type) {
    case 'payment.completed':
      // Fulfill the order
      break;
    case 'payment.failed':
      // Notify the customer
      break;
  }
  
  res.status(200).send('OK');
});`} />
                  <div className="p-4 bg-accent/50 rounded-lg border border-accent">
                    <p className="text-sm"><strong>Security tip:</strong> Always use <code className="bg-secondary/30 px-1 rounded">timingSafeEqual</code> to prevent timing attacks. Never compare signatures with <code className="bg-secondary/30 px-1 rounded">===</code>.</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TESTING */}
            <TabsContent value="testing" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Sandbox Environment</CardTitle>
                  <CardDescription>Test your integration without processing real payments</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-medium mb-1">Sandbox Base URL</h4>
                      <CodeBlock code="https://api.sandbox.bmaglasspay.com" />
                    </div>
                    <div className="p-4 border rounded-lg">
                      <h4 className="font-medium mb-1">Production Base URL</h4>
                      <CodeBlock code="https://api.bmaglasspay.com" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Test Cards & Phone Numbers</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Card Numbers</h4>
                      <div className="space-y-2">
                        {[
                          { number: "4242 4242 4242 4242", result: "Always succeeds", type: "Visa" },
                          { number: "5555 5555 5555 4444", result: "Always succeeds", type: "Mastercard" },
                          { number: "4000 0000 0000 0002", result: "Always declined", type: "Visa" },
                          { number: "4000 0027 6000 3184", result: "Requires 3D Secure", type: "Visa" },
                          { number: "4000 0000 0000 9995", result: "Insufficient funds", type: "Visa" },
                        ].map((card) => (
                          <div key={card.number} className="flex items-center gap-4 p-2.5 border rounded-lg text-sm">
                            <code className="font-mono flex-1">{card.number}</code>
                            <Badge variant="outline">{card.type}</Badge>
                            <span className="text-muted-foreground">{card.result}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">Mobile Money Test Numbers</h4>
                      <div className="space-y-2">
                        {[
                          { number: "+260970000001", result: "Always succeeds", provider: "MTN" },
                          { number: "+260960000001", result: "Always succeeds", provider: "Airtel" },
                          { number: "+260950000001", result: "Always succeeds", provider: "Zamtel" },
                          { number: "+260970000099", result: "Always fails", provider: "MTN" },
                          { number: "+260970000050", result: "Timeout (30s)", provider: "MTN" },
                        ].map((phone) => (
                          <div key={phone.number} className="flex items-center gap-4 p-2.5 border rounded-lg text-sm">
                            <code className="font-mono flex-1">{phone.number}</code>
                            <Badge variant="outline">{phone.provider}</Badge>
                            <span className="text-muted-foreground">{phone.result}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 bg-accent/50 rounded-lg border border-accent">
                      <p className="text-sm">
                        <strong>Note:</strong> Use any future expiry date and any 3-digit CVC for test cards. 
                        Test transactions appear in your dashboard but no real money is processed.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>API Rate Limits</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {[
                      { tier: "Free", limit: "100 req/hour" },
                      { tier: "Starter", limit: "1,000 req/hour" },
                      { tier: "Business", limit: "10,000 req/hour" },
                      { tier: "Enterprise", limit: "Unlimited" },
                    ].map((r) => (
                      <div key={r.tier} className="flex items-center justify-between p-3 border rounded-lg">
                        <span className="font-medium">{r.tier}</span>
                        <Badge variant="outline">{r.limit}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        {/* CTA */}
        <section className="px-4 max-w-3xl mx-auto mt-16 text-center">
          <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="pt-8 pb-8">
              <h2 className="text-2xl font-bold mb-2">Ready to integrate?</h2>
              <p className="text-muted-foreground mb-6">
                Create a free account to get your API keys and start building.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button size="lg" asChild>
                  <a href="/register">Get API Keys <ArrowRight className="h-4 w-4 ml-2" /></a>
                </Button>
                <Button variant="outline" size="lg" asChild>
                  <a href="/contact">Talk to Sales</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Developers;
