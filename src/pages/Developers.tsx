import React, { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Code2, Book, Webhook, CreditCard, Globe, Copy, Check, 
  ArrowRight, Zap, Shield, Terminal, Package, 
  ShoppingCart, Store, Blocks, Plug, Download, ExternalLink, Play,
  Clock, Star, ChevronRight, Search, FileCode, Key, Users, Repeat,
  AlertTriangle, Gauge, Hash, GitBranch, Smartphone, FileText,
  Receipt, Scale, Send, Link2, RefreshCw, Ban, ArrowLeftRight,
  Database, Lock, Timer, Layers, Rocket, BookOpen
} from "lucide-react";
import { ApiPlayground } from "@/components/developers/ApiPlayground";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";

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
      <pre className="bg-slate-900 text-slate-100 dark:bg-slate-950 border border-slate-800 rounded-lg p-4 overflow-x-auto text-sm font-mono">
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-white hover:bg-slate-800"
        onClick={copy}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
};

const EndpointRow = ({ method, path, description }: { method: string; path: string; description: string }) => {
  const methodColors: Record<string, string> = {
    GET: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    POST: "bg-primary/15 text-primary border-primary/30",
    PUT: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    DELETE: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    PATCH: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30",
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors group cursor-pointer border border-transparent hover:border-border">
      <Badge className={`w-fit font-mono text-xs px-2 py-0.5 border ${methodColors[method] || ""}`}>
        {method}
      </Badge>
      <code className="text-sm font-mono text-foreground flex-1 group-hover:text-primary transition-colors">{path}</code>
      <span className="text-sm text-muted-foreground">{description}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" />
    </div>
  );
};

const PlatformCard = ({ name, icon: Icon, description, status, installCmd, features, docsUrl, repoUrl, onViewDocs }: {
  name: string;
  icon: React.ElementType;
  description: string;
  status: "stable" | "beta" | "coming-soon";
  installCmd?: string;
  features: string[];
  docsUrl?: string;
  repoUrl?: string;
  onViewDocs?: () => void;
}) => {
  const { toast } = useToast();
  
  const handleInstall = () => {
    if (installCmd) {
      navigator.clipboard.writeText(installCmd);
      toast({ title: "Install command copied!", description: installCmd });
    }
  };

  return (
    <Card className="flex flex-col border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{name}</CardTitle>
              <CardDescription className="text-xs">{description}</CardDescription>
            </div>
          </div>
          <Badge 
            variant={status === "stable" ? "default" : status === "beta" ? "secondary" : "outline"}
            className="text-[10px]"
          >
            {status === "coming-soon" ? "Soon" : status === "beta" ? "Beta" : "Stable"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between gap-4 pt-0">
        <ul className="space-y-1.5">
          {features.slice(0, 4).map((f, i) => (
            <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
              <Check className="h-3 w-3 text-primary flex-shrink-0 mt-0.5" /> {f}
            </li>
          ))}
        </ul>
        {installCmd && (
          <div className="text-xs">
            <CodeBlock code={installCmd} />
          </div>
        )}
        <div className="flex gap-2 mt-auto">
          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={onViewDocs}>
            <Book className="h-3 w-3 mr-1" /> Docs
          </Button>
          {status !== "coming-soon" && (
            <Button size="sm" className="flex-1 h-8 text-xs" onClick={handleInstall}>
              <Copy className="h-3 w-3 mr-1" /> Copy Install
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const navItems = [
  { id: "quickstart", label: "Quick Start", icon: Zap },
  { id: "api", label: "API Reference", icon: Terminal },
  { id: "sdks", label: "SDKs & Libraries", icon: Package },
  { id: "plugins", label: "Plugins", icon: Blocks },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "errors", label: "Error Handling", icon: AlertTriangle },
  { id: "ratelimits", label: "Rate Limits", icon: Gauge },
  { id: "idempotency", label: "Idempotency", icon: Hash },
  { id: "versioning", label: "API Versioning", icon: GitBranch },
  { id: "pagination", label: "Pagination", icon: Layers },
  { id: "security", label: "Security", icon: Lock },
  { id: "testing", label: "Testing", icon: CreditCard },
  { id: "playground", label: "API Playground", icon: Play },
  { id: "migration", label: "Migration Guide", icon: ArrowLeftRight },
  { id: "changelog", label: "Changelog", icon: GitBranch },
];

const Developers = () => {
  const [activeSection, setActiveSection] = useState("quickstart");

  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      <Header />
      <main className="flex-1 pt-20">
        {/* Hero Section */}
        <section className="bg-gradient-to-b from-primary/5 via-primary/[0.02] to-transparent border-b border-border/50">
          <div className="px-4 max-w-7xl mx-auto py-12 md:py-16">
            <div className="max-w-3xl">
              <Badge className="mb-4 bg-primary/10 text-primary border-primary/20 hover:bg-primary/15">
                Developer Portal
              </Badge>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 leading-tight">
                Build powerful payment experiences
              </h1>
              <p className="text-lg text-muted-foreground mb-6 max-w-2xl">
                Accept Mobile Money, cards, bank transfers, Bitcoin, and more with our modern APIs. 
                Get started in minutes with comprehensive SDKs, no-code plugins, and a live sandbox.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" className="h-12 px-6 rounded-lg" onClick={() => setActiveSection("quickstart")}>
                  <Zap className="h-4 w-4 mr-2" /> Get Started
                </Button>
                <Button size="lg" variant="outline" className="h-12 px-6 rounded-lg" onClick={() => setActiveSection("api")}>
                  <Book className="h-4 w-4 mr-2" /> API Reference
                </Button>
                <Button size="lg" variant="outline" className="h-12 px-6 rounded-lg" onClick={() => setActiveSection("playground")}>
                  <Play className="h-4 w-4 mr-2" /> Try Playground
                </Button>
              </div>
            </div>

            <div className="mt-8 max-w-xl">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Search documentation..." 
                  className="pl-10 h-11 bg-background border-border rounded-lg"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Stats bar */}
        <section className="border-b border-border/50 bg-background">
          <div className="px-4 max-w-7xl mx-auto py-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 md:gap-6">
              {[
                { label: "API Uptime", value: "99.99%", icon: Shield },
                { label: "Avg Response", value: "89ms", icon: Clock },
                { label: "SDKs", value: "7 Languages", icon: Package },
                { label: "Plugins", value: "10+ Platforms", icon: Plug },
                { label: "API Endpoints", value: "45+", icon: Terminal },
                { label: "Webhook Events", value: "20+", icon: Webhook },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <stat.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Main Content with Sidebar */}
        <section className="px-4 max-w-7xl mx-auto py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8">
            {/* Sidebar Navigation */}
            <nav className="space-y-1 lg:sticky lg:top-24 lg:self-start">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-3">Getting Started</p>
              {navItems.slice(0, 1).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${
                    activeSection === item.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              ))}

              <Separator className="my-3" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-3">API</p>
              {navItems.slice(1, 5).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${
                    activeSection === item.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              ))}

              <Separator className="my-3" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-3">Guides</p>
              {navItems.slice(5, 12).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${
                    activeSection === item.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              ))}

              <Separator className="my-3" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-3">Tools & More</p>
              {navItems.slice(12).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${
                    activeSection === item.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              ))}

              <Separator className="my-3" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-3">Resources</p>
              <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" /> API Status
              </a>
              <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" /> Postman Collection
              </a>
              <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" /> OpenAPI Spec
              </a>
              <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" /> GitHub
              </a>
            </nav>

            {/* Content Area */}
            <div className="min-w-0">
              {/* QUICK START */}
              {activeSection === "quickstart" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Quick Start Guide</h2>
                    <p className="text-muted-foreground">Accept your first payment in under 5 minutes</p>
                  </div>

                  <div className="space-y-6">
                    {[
                      {
                        step: 1,
                        title: "Install the SDK",
                        desc: "Choose your preferred package manager:",
                        codes: [
                          "npm install @bmaglass/payments-js",
                          "pip install bmaglass-payments",
                        ]
                      },
                      {
                        step: 2,
                        title: "Initialize with your API Key",
                        desc: "Get your API key from the Business Dashboard",
                        codes: [`import BMaGlass from '@bmaglass/payments-js';

const bmaglass = new BMaGlass({
  apiKey: 'pk_live_YOUR_API_KEY',
  environment: 'production' // or 'sandbox'
});`]
                      },
                      {
                        step: 3,
                        title: "Create a Payment",
                        desc: "Start accepting Mobile Money, cards, or bank transfers",
                        codes: [`const payment = await bmaglass.payments.create({
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

console.log(payment.checkout_url); // redirect user here`]
                      },
                      {
                        step: 4,
                        title: "Handle Webhooks",
                        desc: "Get notified when payments complete",
                        codes: [`// Express.js example
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-bmaglass-signature'];
  const isValid = bmaglass.webhooks.verify(
    req.body, signature, webhookSecret
  );
  
  if (isValid && req.body.event === 'payment.completed') {
    // Fulfill the order
    fulfillOrder(req.body.data.metadata.order_id);
  }
  res.sendStatus(200);
});`]
                      }
                    ].map((item) => (
                      <Card key={item.step} className="border-0 shadow-sm">
                        <CardContent className="p-6">
                          <div className="flex items-start gap-4">
                            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                              {item.step}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-foreground text-lg mb-1">{item.title}</h3>
                              <p className="text-sm text-muted-foreground mb-4">{item.desc}</p>
                              <div className="space-y-2">
                                {item.codes.map((code, i) => (
                                  <CodeBlock key={i} code={code} />
                                ))}
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Integration Methods */}
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Choose Your Integration Method</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[
                          { title: "Drop-in Checkout", desc: "Pre-built UI, minimal code. Best for most merchants.", icon: Zap, action: "sdks" },
                          { title: "Custom API Integration", desc: "Full control over the payment flow and UI.", icon: Code2, action: "api" },
                          { title: "No-Code Plugins", desc: "WordPress, WooCommerce, Shopify, Odoo — zero code.", icon: Plug, action: "plugins" },
                        ].map((method) => (
                          <button
                            key={method.title}
                            onClick={() => setActiveSection(method.action)}
                            className="p-4 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-left group"
                          >
                            <method.icon className="h-6 w-6 text-primary mb-3" />
                            <h4 className="font-semibold text-sm mb-1 group-hover:text-primary transition-colors">{method.title}</h4>
                            <p className="text-xs text-muted-foreground">{method.desc}</p>
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* API REFERENCE */}
              {activeSection === "api" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">API Reference</h2>
                    <p className="text-muted-foreground">Complete reference for the BMaGlass Pay REST API v1</p>
                  </div>

                  {/* Base URL */}
                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge variant="outline" className="text-xs">Base URL</Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="bg-muted/50 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Production</p>
                          <code className="text-sm font-mono">https://api.bmaglasspay.com/v1</code>
                        </div>
                        <div className="bg-muted/50 rounded-lg px-3 py-2">
                          <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Sandbox</p>
                          <code className="text-sm font-mono">https://api.sandbox.bmaglasspay.com/v1</code>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Authentication */}
                  <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <Key className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">Authentication</CardTitle>
                      </div>
                      <CardDescription>All API requests require Bearer token authentication</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={`curl -X POST https://api.bmaglasspay.com/v1/payments \\
  -H "Authorization: Bearer pk_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: unique-request-id-123"`} />
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
                          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">pk_test_</code>
                          <span className="text-muted-foreground text-xs">Sandbox keys</span>
                        </div>
                        <div className="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2">
                          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">pk_live_</code>
                          <span className="text-muted-foreground text-xs">Production keys</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* API Endpoints */}
                  {[
                    {
                      title: "Payments",
                      icon: CreditCard,
                      desc: "Create, retrieve, capture, and refund payments",
                      endpoints: [
                        { method: "POST", path: "/v1/payments", desc: "Create a payment" },
                        { method: "GET", path: "/v1/payments/:id", desc: "Get payment details" },
                        { method: "GET", path: "/v1/payments", desc: "List all payments" },
                        { method: "POST", path: "/v1/payments/:id/capture", desc: "Capture authorized payment" },
                        { method: "POST", path: "/v1/payments/:id/refund", desc: "Refund a payment" },
                        { method: "POST", path: "/v1/payments/:id/void", desc: "Void a payment" },
                      ]
                    },
                    {
                      title: "Payment Links",
                      icon: Link2,
                      desc: "Create shareable payment links — no code needed",
                      endpoints: [
                        { method: "POST", path: "/v1/payment-links", desc: "Create payment link" },
                        { method: "GET", path: "/v1/payment-links/:id", desc: "Get payment link" },
                        { method: "GET", path: "/v1/payment-links", desc: "List payment links" },
                        { method: "PATCH", path: "/v1/payment-links/:id", desc: "Update payment link" },
                        { method: "DELETE", path: "/v1/payment-links/:id", desc: "Deactivate link" },
                      ]
                    },
                    {
                      title: "Transfers & Payouts",
                      icon: Send,
                      desc: "Send money to bank accounts, mobile wallets, or batch payouts",
                      endpoints: [
                        { method: "POST", path: "/v1/transfers", desc: "Create a transfer" },
                        { method: "GET", path: "/v1/transfers/:id", desc: "Get transfer status" },
                        { method: "GET", path: "/v1/transfers", desc: "List transfers" },
                        { method: "POST", path: "/v1/payouts/batch", desc: "Create batch payout" },
                        { method: "GET", path: "/v1/payouts/batch/:id", desc: "Get batch status" },
                      ]
                    },
                    {
                      title: "Invoices",
                      icon: Receipt,
                      desc: "Create, send, and manage invoices programmatically",
                      endpoints: [
                        { method: "POST", path: "/v1/invoices", desc: "Create invoice" },
                        { method: "GET", path: "/v1/invoices/:id", desc: "Get invoice" },
                        { method: "GET", path: "/v1/invoices", desc: "List invoices" },
                        { method: "POST", path: "/v1/invoices/:id/send", desc: "Send invoice to customer" },
                        { method: "POST", path: "/v1/invoices/:id/remind", desc: "Send payment reminder" },
                        { method: "PUT", path: "/v1/invoices/:id", desc: "Update invoice" },
                        { method: "DELETE", path: "/v1/invoices/:id", desc: "Delete draft invoice" },
                      ]
                    },
                    {
                      title: "Customers",
                      icon: Users,
                      desc: "Manage customer records and saved payment methods",
                      endpoints: [
                        { method: "POST", path: "/v1/customers", desc: "Create a customer" },
                        { method: "GET", path: "/v1/customers/:id", desc: "Retrieve customer" },
                        { method: "PUT", path: "/v1/customers/:id", desc: "Update customer" },
                        { method: "DELETE", path: "/v1/customers/:id", desc: "Delete customer" },
                        { method: "GET", path: "/v1/customers/:id/payment-methods", desc: "List saved methods" },
                      ]
                    },
                    {
                      title: "Virtual Cards",
                      icon: CreditCard,
                      desc: "Issue, fund, and manage virtual payment cards",
                      endpoints: [
                        { method: "POST", path: "/v1/cards", desc: "Create virtual card" },
                        { method: "GET", path: "/v1/cards/:id", desc: "Get card details" },
                        { method: "GET", path: "/v1/cards", desc: "List cards" },
                        { method: "POST", path: "/v1/cards/:id/fund", desc: "Fund a card" },
                        { method: "POST", path: "/v1/cards/:id/freeze", desc: "Freeze card" },
                        { method: "POST", path: "/v1/cards/:id/unfreeze", desc: "Unfreeze card" },
                        { method: "GET", path: "/v1/cards/:id/transactions", desc: "Card transactions" },
                      ]
                    },
                    {
                      title: "Subscriptions",
                      icon: Repeat,
                      desc: "Recurring billing and subscription management",
                      endpoints: [
                        { method: "POST", path: "/v1/subscriptions", desc: "Create subscription" },
                        { method: "GET", path: "/v1/subscriptions/:id", desc: "Get subscription" },
                        { method: "GET", path: "/v1/subscriptions", desc: "List subscriptions" },
                        { method: "PATCH", path: "/v1/subscriptions/:id", desc: "Update subscription" },
                        { method: "POST", path: "/v1/subscriptions/:id/cancel", desc: "Cancel subscription" },
                        { method: "POST", path: "/v1/subscriptions/:id/pause", desc: "Pause subscription" },
                        { method: "POST", path: "/v1/subscriptions/:id/resume", desc: "Resume subscription" },
                      ]
                    },
                    {
                      title: "Disputes",
                      icon: Scale,
                      desc: "Manage payment disputes and chargebacks",
                      endpoints: [
                        { method: "GET", path: "/v1/disputes", desc: "List disputes" },
                        { method: "GET", path: "/v1/disputes/:id", desc: "Get dispute details" },
                        { method: "POST", path: "/v1/disputes/:id/accept", desc: "Accept dispute" },
                        { method: "POST", path: "/v1/disputes/:id/contest", desc: "Contest dispute" },
                        { method: "POST", path: "/v1/disputes/:id/evidence", desc: "Submit evidence" },
                      ]
                    },
                    {
                      title: "Webhooks",
                      icon: Webhook,
                      desc: "Manage webhook endpoints and subscriptions",
                      endpoints: [
                        { method: "POST", path: "/v1/webhooks", desc: "Create webhook endpoint" },
                        { method: "GET", path: "/v1/webhooks", desc: "List webhooks" },
                        { method: "DELETE", path: "/v1/webhooks/:id", desc: "Delete webhook" },
                        { method: "GET", path: "/v1/webhooks/:id/deliveries", desc: "List deliveries" },
                        { method: "POST", path: "/v1/webhooks/:id/test", desc: "Send test event" },
                      ]
                    },
                    {
                      title: "Reporting",
                      icon: FileText,
                      desc: "Generate reports and export transaction data",
                      endpoints: [
                        { method: "GET", path: "/v1/reports/transactions", desc: "Transaction report" },
                        { method: "GET", path: "/v1/reports/settlements", desc: "Settlement report" },
                        { method: "GET", path: "/v1/reports/payouts", desc: "Payout report" },
                        { method: "POST", path: "/v1/reports/export", desc: "Export to CSV/PDF" },
                        { method: "GET", path: "/v1/balance", desc: "Account balance" },
                      ]
                    },
                  ].map((section) => (
                    <Card key={section.title} className="border-0 shadow-sm">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-2">
                          <section.icon className="h-5 w-5 text-primary" />
                          <div>
                            <CardTitle className="text-lg">{section.title}</CardTitle>
                            <CardDescription className="text-sm">{section.desc}</CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-1 pt-0">
                        {section.endpoints.map((ep, i) => (
                          <EndpointRow key={i} method={ep.method} path={ep.path} description={ep.desc} />
                        ))}
                      </CardContent>
                    </Card>
                  ))}

                  {/* Payment Methods */}
                  <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Supported Payment Methods</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[
                          { method: "mobile_money", label: "Mobile Money", providers: "MTN, Airtel, Zamtel" },
                          { method: "card", label: "Card Payments", providers: "Visa, Mastercard, Amex" },
                          { method: "bank_transfer", label: "Bank Transfer", providers: "All Zambian banks" },
                          { method: "ussd", label: "USSD", providers: "Feature phone support" },
                          { method: "bitcoin", label: "Bitcoin", providers: "On-chain + Lightning" },
                          { method: "paypal", label: "PayPal", providers: "International payments" },
                          { method: "qr_code", label: "QR Code", providers: "Scan & pay" },
                          { method: "bnpl", label: "Pay in 4", providers: "Installment payments" },
                          { method: "wallet", label: "BMaGlass Wallet", providers: "Instant transfers" },
                        ].map((pm) => (
                          <div key={pm.method} className="p-3 rounded-lg bg-muted/50 border border-border/50">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm text-foreground">{pm.label}</span>
                              <code className="text-[10px] bg-background px-1.5 py-0.5 rounded border">{pm.method}</code>
                            </div>
                            <p className="text-xs text-muted-foreground">{pm.providers}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Response Codes */}
                  <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Response Codes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {[
                          { code: "200", desc: "Success" },
                          { code: "201", desc: "Created" },
                          { code: "202", desc: "Accepted (async processing)" },
                          { code: "400", desc: "Bad Request" },
                          { code: "401", desc: "Unauthorized" },
                          { code: "403", desc: "Forbidden" },
                          { code: "404", desc: "Not Found" },
                          { code: "409", desc: "Conflict (idempotency)" },
                          { code: "422", desc: "Validation Error" },
                          { code: "429", desc: "Rate Limited" },
                          { code: "500", desc: "Server Error" },
                          { code: "503", desc: "Service Unavailable" },
                        ].map((r) => (
                          <div key={r.code} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                            <Badge 
                              variant={r.code.startsWith("2") ? "default" : r.code.startsWith("4") ? "secondary" : "destructive"} 
                              className="font-mono w-12 justify-center text-xs"
                            >
                              {r.code}
                            </Badge>
                            <span className="text-sm text-muted-foreground">{r.desc}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* SDKs */}
              {activeSection === "sdks" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">SDKs & Libraries</h2>
                    <p className="text-muted-foreground">Official client libraries for popular programming languages</p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Total Downloads", value: "200K+", icon: Download },
                      { label: "Languages", value: "7 SDKs", icon: Package },
                      { label: "Latest Release", value: "2 days ago", icon: Clock },
                      { label: "License", value: "MIT", icon: Shield },
                    ].map((stat) => (
                      <Card key={stat.label} className="border-0 shadow-sm">
                        <CardContent className="p-4 flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <stat.icon className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">{stat.label}</p>
                            <p className="font-semibold text-sm">{stat.value}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                      {
                        lang: "JavaScript / Node.js",
                        icon: "JS",
                        version: "v2.1.0",
                        downloads: "45.2K",
                        stars: 328,
                        color: "from-yellow-500/20 to-yellow-600/10",
                        install: "npm install @bmaglass/payments-js",
                        features: ["TypeScript support", "Browser & Node.js", "Webhook helpers", "Retry logic"],
                      },
                      {
                        lang: "Python",
                        icon: "PY",
                        version: "v1.8.0",
                        downloads: "28.7K",
                        stars: 215,
                        color: "from-blue-500/20 to-blue-600/10",
                        install: "pip install bmaglass-payments",
                        features: ["Async support", "Type hints", "Django/Flask plugins", "Auto-retries"],
                      },
                      {
                        lang: "PHP",
                        icon: "PHP",
                        version: "v1.5.0",
                        downloads: "18.3K",
                        stars: 142,
                        color: "from-indigo-500/20 to-indigo-600/10",
                        install: "composer require bmaglass/payments-php",
                        features: ["PHP 8.1+", "Laravel support", "PSR-18 HTTP", "Webhook middleware"],
                      },
                      {
                        lang: "Go",
                        icon: "GO",
                        version: "v1.2.0",
                        downloads: "8.1K",
                        stars: 89,
                        color: "from-cyan-500/20 to-cyan-600/10",
                        install: "go get github.com/bmaglass/payments-go",
                        features: ["Context support", "Connection pooling", "Idiomatic Go", "Zero dependencies"],
                      },
                      {
                        lang: "Ruby",
                        icon: "RB",
                        version: "v1.3.0",
                        downloads: "12.4K",
                        stars: 97,
                        color: "from-red-500/20 to-red-600/10",
                        install: "gem install bmaglass-payments",
                        features: ["Rails integration", "Webhook helpers", "Auto-retries", "Type checked"],
                      },
                      {
                        lang: "C# / .NET",
                        icon: "C#",
                        version: "v1.1.0",
                        downloads: "9.8K",
                        stars: 64,
                        color: "from-purple-500/20 to-purple-600/10",
                        install: "dotnet add package BMaGlass.Payments",
                        features: [".NET 6+", "Async/await", "DI support", "Strong typing"],
                      },
                      {
                        lang: "React Native",
                        icon: "RN",
                        version: "v1.0.0",
                        downloads: "5.2K",
                        stars: 43,
                        color: "from-sky-500/20 to-sky-600/10",
                        install: "npm install @bmaglass/react-native-payments",
                        features: ["iOS & Android", "Drop-in UI", "Biometric auth", "Mobile Money support"],
                      },
                    ].map((sdk) => (
                      <Card key={sdk.lang} className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow">
                        <div className={`h-1 bg-gradient-to-r ${sdk.color}`} />
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${sdk.color} flex items-center justify-center font-bold text-xs border border-border/40`}>
                                {sdk.icon}
                              </div>
                              <div>
                                <CardTitle className="text-base">{sdk.lang}</CardTitle>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                  <span className="flex items-center gap-1"><Download className="h-3 w-3" />{sdk.downloads}</span>
                                  <span className="flex items-center gap-1"><Star className="h-3 w-3" />{sdk.stars}</span>
                                </div>
                              </div>
                            </div>
                            <Badge variant="outline" className="font-mono text-xs">{sdk.version}</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-0">
                          <div className="flex flex-wrap gap-1.5">
                            {sdk.features.map((f) => (
                              <Badge key={f} variant="secondary" className="text-[10px] font-normal">
                                {f}
                              </Badge>
                            ))}
                          </div>
                          <CodeBlock code={sdk.install} />
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs">
                              <ExternalLink className="h-3 w-3 mr-1" /> GitHub
                            </Button>
                            <Button size="sm" className="flex-1 h-8 text-xs">
                              <Book className="h-3 w-3 mr-1" /> Docs
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Drop-in UI */}
                  <Card className="border-primary/20 bg-primary/5">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary/10">
                          <Zap className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">Frontend Drop-in UI</CardTitle>
                          <CardDescription>Embed a pre-built payment form — no backend required</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={`<script src="https://js.bmaglasspay.com/v2/checkout.js"></script>

<div id="bmaglass-checkout"></div>

<script>
  BMaGlassCheckout.init({
    publicKey: 'pk_live_YOUR_KEY',
    amount: 150.00,
    currency: 'ZMW',
    methods: ['mobile_money', 'card', 'bitcoin'],
    theme: { primary: '#2563eb' },
    onSuccess: (payment) => console.log('Paid:', payment.id),
    onError: (error) => console.error('Failed:', error.message)
  });
</script>`} />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* PLUGINS */}
              {activeSection === "plugins" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Plugins & Integrations</h2>
                    <p className="text-muted-foreground">Install once, accept payments forever. No coding required.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <PlatformCard name="WordPress" icon={Globe} description="Payment gateway for WordPress" status="stable"
                      installCmd="Upload bmaglass-pay.zip via Plugins"
                      features={["One-click install", "Donation forms", "Gutenberg block", "All payment methods"]} />
                    <PlatformCard name="WooCommerce" icon={ShoppingCart} description="Full checkout integration" status="stable"
                      installCmd="Upload bmaglass-woocommerce.zip"
                      features={["All payment methods", "Auto order updates", "Multi-currency", "Refunds from admin"]} />
                    <PlatformCard name="Odoo" icon={Blocks} description="Payment acquirer for Odoo ERP" status="stable"
                      installCmd="odoo-bin -i bmaglass_payment"
                      features={["Odoo 16 & 17", "POS integration", "Invoice links", "Auto reconciliation"]} />
                    <PlatformCard name="Shopify" icon={Store} description="Shopify payment app" status="stable"
                      features={["Shopify Payments API", "Mobile Money checkout", "Auto fulfillment", "Multi-currency"]} />
                    <PlatformCard name="Laravel" icon={Code2} description="First-party PHP package" status="stable"
                      installCmd="composer require bmaglass/laravel-payments"
                      features={["Cashier-style API", "Blade components", "Webhook verify", "Artisan commands"]} />
                    <PlatformCard name="Django" icon={Code2} description="Python Django integration" status="stable"
                      installCmd="pip install bmaglass-django"
                      features={["Django 4.x+", "Template tags", "Signals for events", "Admin dashboard"]} />
                    <PlatformCard name="Magento" icon={ShoppingCart} description="Adobe Commerce plugin" status="beta"
                      features={["Magento 2.4+", "Multi-store support", "Custom checkout", "API integration"]} />
                    <PlatformCard name="PrestaShop" icon={Store} description="PrestaShop module" status="stable"
                      installCmd="Upload via Modules Manager"
                      features={["1-click install", "Multi-currency", "Order management", "Refund support"]} />
                    <PlatformCard name="Zapier" icon={Zap} description="Connect 5000+ apps" status="stable"
                      features={["Payment triggers", "Custom actions", "No-code automation", "Instant updates"]} />
                    <PlatformCard name="React / Next.js" icon={Code2} description="React component library" status="stable"
                      installCmd="npm install @bmaglass/react-checkout"
                      features={["Drop-in components", "Server components", "Hooks API", "TypeScript"]} />
                  </div>
                </div>
              )}

              {/* WEBHOOKS */}
              {activeSection === "webhooks" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Webhooks</h2>
                    <p className="text-muted-foreground">Receive real-time notifications for all payment events</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Available Events</CardTitle>
                      <CardDescription>Subscribe to events that matter to your application</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        {[
                          { group: "Payments", events: ["payment.created", "payment.completed", "payment.failed", "payment.refunded", "payment.captured", "payment.voided"] },
                          { group: "Transfers", events: ["transfer.created", "transfer.completed", "transfer.failed", "transfer.reversed"] },
                          { group: "Subscriptions", events: ["subscription.created", "subscription.renewed", "subscription.cancelled", "subscription.paused", "subscription.payment_failed"] },
                          { group: "Invoices", events: ["invoice.created", "invoice.sent", "invoice.paid", "invoice.overdue", "invoice.cancelled"] },
                          { group: "Disputes", events: ["dispute.created", "dispute.updated", "dispute.won", "dispute.lost"] },
                          { group: "Cards", events: ["card.created", "card.funded", "card.transaction", "card.frozen", "card.closed"] },
                          { group: "Customers", events: ["customer.created", "customer.updated", "customer.deleted"] },
                          { group: "Payouts", events: ["payout.created", "payout.completed", "payout.failed"] },
                        ].map((section) => (
                          <div key={section.group}>
                            <h4 className="font-medium text-sm mb-2 text-foreground">{section.group}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {section.events.map((event) => (
                                <div key={event} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                                  <Webhook className="h-3.5 w-3.5 text-primary" />
                                  <code className="text-xs font-mono">{event}</code>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Webhook Payload</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={`{
  "id": "evt_abc123def456",
  "type": "payment.completed",
  "created": "2026-03-08T14:30:45Z",
  "livemode": true,
  "data": {
    "id": "pay_xyz789",
    "amount": 150.00,
    "currency": "ZMW",
    "status": "completed",
    "customer": { "phone": "+260971234567" },
    "metadata": { "order_id": "ORD-1234" }
  }
}`} />
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Signature Verification</CardTitle>
                      <CardDescription>Always verify webhook signatures to ensure authenticity</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <CodeBlock code={`import crypto from 'crypto';

function verifyWebhook(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

// Express middleware
app.post('/webhook', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['x-bmaglass-signature'];
  const timestamp = req.headers['x-bmaglass-timestamp'];
  
  // Reject events older than 5 minutes (replay protection)
  if (Date.now() / 1000 - parseInt(timestamp) > 300) {
    return res.status(400).send('Event too old');
  }
  
  if (!verifyWebhook(req.body, sig, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process the event
  const event = JSON.parse(req.body);
  handleEvent(event);
  
  res.json({ received: true });
});`} />

                      <Card className="border-primary/20 bg-primary/5">
                        <CardContent className="p-4">
                          <h4 className="font-medium text-sm mb-2">Retry Policy</h4>
                          <p className="text-xs text-muted-foreground mb-2">Failed webhook deliveries are retried with exponential backoff:</p>
                          <div className="grid grid-cols-5 gap-2 text-center">
                            {["1 min", "5 min", "30 min", "2 hrs", "24 hrs"].map((t, i) => (
                              <div key={t} className="bg-background rounded-lg p-2 border">
                                <p className="text-xs font-semibold">Retry {i + 1}</p>
                                <p className="text-[10px] text-muted-foreground">{t}</p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* ERROR HANDLING */}
              {activeSection === "errors" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Error Handling</h2>
                    <p className="text-muted-foreground">Comprehensive error codes and troubleshooting guide</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Error Response Format</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={`{
  "error": {
    "type": "invalid_request_error",
    "code": "amount_too_small",
    "message": "Amount must be at least 1.00 ZMW",
    "param": "amount",
    "doc_url": "https://docs.bmaglasspay.com/errors/amount_too_small",
    "request_id": "req_abc123"
  }
}`} />
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Error Types</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {[
                          { type: "invalid_request_error", desc: "Invalid parameters, missing fields, or malformed request", example: "Missing required field 'amount'" },
                          { type: "authentication_error", desc: "API key is invalid, expired, or missing", example: "Invalid API key provided" },
                          { type: "permission_error", desc: "API key doesn't have permission for this action", example: "Live key required for production" },
                          { type: "rate_limit_error", desc: "Too many requests in a given time period", example: "Rate limit exceeded, retry after 30s" },
                          { type: "payment_error", desc: "Payment-specific failure (declined, insufficient funds)", example: "Card was declined by the issuer" },
                          { type: "idempotency_error", desc: "Idempotency key reused with different parameters", example: "Idempotency key already used" },
                          { type: "api_error", desc: "Internal server error (rare)", example: "An unexpected error occurred" },
                        ].map((err) => (
                          <div key={err.type} className="p-4 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                              <code className="text-sm font-mono font-semibold text-foreground">{err.type}</code>
                            </div>
                            <p className="text-sm text-muted-foreground mb-1">{err.desc}</p>
                            <p className="text-xs text-muted-foreground italic">e.g. "{err.example}"</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Payment-Specific Error Codes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {[
                          { code: "card_declined", desc: "Card was declined" },
                          { code: "insufficient_funds", desc: "Not enough balance" },
                          { code: "expired_card", desc: "Card has expired" },
                          { code: "incorrect_cvc", desc: "CVC check failed" },
                          { code: "processing_error", desc: "Processing error" },
                          { code: "amount_too_small", desc: "Below minimum amount" },
                          { code: "amount_too_large", desc: "Exceeds maximum amount" },
                          { code: "duplicate_transaction", desc: "Possible duplicate" },
                          { code: "mobile_money_timeout", desc: "USSD prompt expired" },
                          { code: "mobile_money_cancelled", desc: "User cancelled" },
                          { code: "currency_not_supported", desc: "Currency unavailable" },
                          { code: "provider_unavailable", desc: "Provider is down" },
                        ].map((err) => (
                          <div key={err.code} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                            <code className="text-xs font-mono text-destructive">{err.code}</code>
                            <span className="text-xs text-muted-foreground">{err.desc}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Best Practices</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={`try {
  const payment = await bmaglass.payments.create({
    amount: 150, currency: 'ZMW',
    payment_method: 'mobile_money',
    customer: { phone: '+260971234567' }
  });
} catch (error) {
  switch (error.type) {
    case 'invalid_request_error':
      // Fix the request parameters
      console.log('Param:', error.param, 'Message:', error.message);
      break;
    case 'payment_error':
      // Show user-friendly message
      showError(getUserMessage(error.code));
      break;
    case 'rate_limit_error':
      // Retry after the specified time
      await sleep(error.retryAfter * 1000);
      return retry();
    case 'api_error':
      // Retry with exponential backoff
      return retryWithBackoff();
  }
}`} />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* RATE LIMITS */}
              {activeSection === "ratelimits" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Rate Limits</h2>
                    <p className="text-muted-foreground">Understand and handle API rate limits</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Rate Limit Tiers</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-3 px-2 font-medium">Plan</th>
                              <th className="text-left py-3 px-2 font-medium">Requests/min</th>
                              <th className="text-left py-3 px-2 font-medium">Requests/hour</th>
                              <th className="text-left py-3 px-2 font-medium">Burst</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              { plan: "Free", rpm: "60", rph: "1,000", burst: "10/sec" },
                              { plan: "Starter", rpm: "300", rph: "10,000", burst: "50/sec" },
                              { plan: "Professional", rpm: "1,000", rph: "50,000", burst: "100/sec" },
                              { plan: "Enterprise", rpm: "5,000", rph: "Unlimited", burst: "500/sec" },
                            ].map((tier) => (
                              <tr key={tier.plan} className="border-b last:border-0">
                                <td className="py-3 px-2 font-medium">{tier.plan}</td>
                                <td className="py-3 px-2 text-muted-foreground">{tier.rpm}</td>
                                <td className="py-3 px-2 text-muted-foreground">{tier.rph}</td>
                                <td className="py-3 px-2 text-muted-foreground">{tier.burst}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Rate Limit Headers</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {[
                          { header: "X-RateLimit-Limit", desc: "Maximum requests per window" },
                          { header: "X-RateLimit-Remaining", desc: "Requests remaining in current window" },
                          { header: "X-RateLimit-Reset", desc: "UTC timestamp when the window resets" },
                          { header: "Retry-After", desc: "Seconds to wait (only on 429 responses)" },
                        ].map((h) => (
                          <div key={h.header} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                            <code className="text-xs font-mono font-semibold text-primary">{h.header}</code>
                            <span className="text-xs text-muted-foreground">{h.desc}</span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4">
                        <CodeBlock code={`// Handle rate limiting with exponential backoff
async function apiCallWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        const retryAfter = error.headers['retry-after'] || Math.pow(2, i);
        console.log(\`Rate limited. Retrying in \${retryAfter}s\`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
      } else throw error;
    }
  }
  throw new Error('Max retries exceeded');
}`} />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* IDEMPOTENCY */}
              {activeSection === "idempotency" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Idempotency</h2>
                    <p className="text-muted-foreground">Safely retry requests without creating duplicate charges</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardContent className="p-6">
                      <p className="text-sm text-muted-foreground mb-4">
                        Pass an <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">Idempotency-Key</code> header 
                        with any POST request. If the same key is used again within 24 hours, the API returns the original 
                        response instead of creating a duplicate resource.
                      </p>
                      <CodeBlock code={`// Always use idempotency keys for payment creation
const payment = await bmaglass.payments.create({
  amount: 150.00,
  currency: 'ZMW',
  payment_method: 'mobile_money',
  customer: { phone: '+260971234567' }
}, {
  idempotencyKey: 'order_1234_payment_attempt_1'
});

// If the request is retried with the same key,
// you get the same payment back (no duplicate charge)`} />
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Guidelines</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-3">
                        {[
                          "Use unique keys per distinct action (e.g., order_id + attempt_number)",
                          "Keys expire after 24 hours — safe to reuse after that",
                          "Only POST/PUT/PATCH requests support idempotency",
                          "GET and DELETE are inherently idempotent",
                          "A 409 Conflict is returned if the same key is used with different parameters",
                          "Store the idempotency key with the order for debugging",
                        ].map((tip, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* API VERSIONING */}
              {activeSection === "versioning" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">API Versioning</h2>
                    <p className="text-muted-foreground">Backward-compatible updates and version lifecycle</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Version Strategy</CardTitle>
                      <CardDescription>We use URL-based versioning for major changes and header-based for minor variations</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                          <Badge className="mb-2">Current</Badge>
                          <h4 className="font-semibold text-foreground mb-1">v1 — Stable</h4>
                          <code className="text-sm font-mono text-muted-foreground">https://api.bmaglasspay.com/v1</code>
                          <p className="text-xs text-muted-foreground mt-2">Fully supported. All new features land here first.</p>
                        </div>
                        <div className="p-4 rounded-xl bg-muted/50 border border-border/50">
                          <Badge variant="secondary" className="mb-2">Preview</Badge>
                          <h4 className="font-semibold text-foreground mb-1">v2 — Beta Preview</h4>
                          <code className="text-sm font-mono text-muted-foreground">https://api.bmaglasspay.com/v2</code>
                          <p className="text-xs text-muted-foreground mt-2">Breaking changes and redesigned endpoints. Not for production.</p>
                        </div>
                      </div>

                      <CodeBlock code={`# Specify version in URL (recommended)
curl https://api.bmaglasspay.com/v1/payments

# Or via header (for minor version pinning)
curl https://api.bmaglasspay.com/payments \\
  -H "BMaGlass-Version: 2026-03-01"`} />
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Version Lifecycle</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {[
                          { phase: "Active", desc: "Fully supported with new features, patches, and security updates.", duration: "Current version", color: "bg-emerald-500" },
                          { phase: "Maintenance", desc: "Security patches only. No new features. 12-month window after next major release.", duration: "12 months", color: "bg-amber-500" },
                          { phase: "Deprecated", desc: "Read-only access. Returns Sunset header. 6-month migration window.", duration: "6 months", color: "bg-red-500" },
                          { phase: "Retired", desc: "Requests return 410 Gone. All traffic must migrate to new version.", duration: "Permanent", color: "bg-muted-foreground" },
                        ].map((p, i) => (
                          <div key={p.phase} className="flex items-start gap-4">
                            <div className="flex flex-col items-center">
                              <div className={`w-3 h-3 rounded-full ${p.color}`} />
                              {i < 3 && <div className="w-0.5 h-8 bg-border" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-sm text-foreground">{p.phase}</h4>
                                <Badge variant="outline" className="text-[10px]">{p.duration}</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Breaking vs Non-Breaking Changes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
                            <Check className="h-4 w-4 text-primary" /> Non-Breaking (no version bump)
                          </h4>
                          <ul className="space-y-1.5">
                            {[
                              "Adding new API endpoints",
                              "Adding optional request parameters",
                              "Adding new response fields",
                              "Adding new webhook event types",
                              "Adding new enum values",
                              "Relaxing validation constraints",
                            ].map((item, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                                <span className="text-primary mt-1">•</span> {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-destructive" /> Breaking (requires new version)
                          </h4>
                          <ul className="space-y-1.5">
                            {[
                              "Removing or renaming endpoints",
                              "Removing or renaming response fields",
                              "Changing field types or formats",
                              "Making optional params required",
                              "Changing error code semantics",
                              "Modifying authentication flow",
                            ].map((item, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                                <span className="text-destructive mt-1">•</span> {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Sunset Header</CardTitle>
                      <CardDescription>Deprecated endpoints include a Sunset header with the retirement date</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={`HTTP/1.1 200 OK
Sunset: Sat, 01 Sep 2027 00:00:00 GMT
Deprecation: true
Link: <https://docs.bmaglasspay.com/migration/v2>; rel="successor-version"

// Your SDK will log warnings automatically:
// ⚠️ BMaGlass: /v1/payments is deprecated. Migrate to /v2/payments by Sep 2027.`} />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* SECURITY BEST PRACTICES */}
              {activeSection === "security" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Security Best Practices</h2>
                    <p className="text-muted-foreground">Protect your integration and your customers' data</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <Key className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">API Key Management</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        {[
                          { rule: "Never expose secret keys in frontend code", severity: "critical" },
                          { rule: "Use publishable keys (pk_) for client-side, secret keys (sk_) for server-side", severity: "critical" },
                          { rule: "Rotate API keys regularly — at least every 90 days", severity: "high" },
                          { rule: "Use environment variables, never hardcode keys", severity: "high" },
                          { rule: "Set up IP whitelisting to restrict key usage", severity: "medium" },
                          { rule: "Use separate keys for test and production", severity: "medium" },
                        ].map((item) => (
                          <div key={item.rule} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                            <Badge variant={item.severity === "critical" ? "destructive" : item.severity === "high" ? "default" : "secondary"} className="text-[10px] shrink-0">
                              {item.severity}
                            </Badge>
                            <span className="text-sm text-muted-foreground">{item.rule}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <Shield className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">PCI DSS Compliance</CardTitle>
                      </div>
                      <CardDescription>Our infrastructure is PCI DSS Level 1 certified</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        BMaGlass Pay handles all sensitive card data on our servers. When using our Drop-in Checkout 
                        or tokenization API, raw card numbers never touch your servers — keeping you out of PCI scope.
                      </p>
                      <CodeBlock code={`// Tokenize card on client-side (PCI-safe)
const token = await bmaglass.tokens.create({
  card: {
    number: '4242424242424242',
    exp_month: 12,
    exp_year: 2028,
    cvc: '123'
  }
});

// Send only the token to your server
// token.id = "tok_abc123" — no raw card data`} />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {["Tokenized Storage", "TLS 1.3 Encryption", "3D Secure 2.0", "Fraud Detection"].map((f) => (
                          <div key={f} className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-center">
                            <p className="text-xs font-medium text-primary">{f}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">IP Whitelisting</CardTitle>
                      <CardDescription>Restrict API access to trusted IP addresses</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={`// Configure allowed IPs in your dashboard or via API
POST /v1/security/ip-whitelist
{
  "ip_addresses": [
    "203.0.113.0/24",    // Office network
    "198.51.100.42"      // Production server
  ],
  "enforce": true         // Block requests from other IPs
}

// Requests from non-whitelisted IPs return:
// 403 Forbidden — "IP address not whitelisted"`} />
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Webhook Security</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ul className="space-y-2">
                        {[
                          "Always verify webhook signatures using HMAC-SHA256",
                          "Reject events with timestamps older than 5 minutes (replay protection)",
                          "Use HTTPS endpoints only — HTTP webhooks are rejected",
                          "Return 200 quickly, process asynchronously",
                          "Implement idempotent event handlers (you may receive duplicates)",
                          "Log all webhook events for debugging and audit trails",
                        ].map((tip, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">AML/CFT & Fraud Prevention</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        BMaGlass Pay automatically screens transactions against sanctions lists and monitors 
                        for suspicious patterns. You can configure custom fraud rules via the dashboard or API.
                      </p>
                      <CodeBlock code={`// Configure fraud rules
POST /v1/fraud-rules
{
  "name": "High-value transaction alert",
  "rule_type": "amount_threshold",
  "conditions": {
    "amount_gte": 50000,
    "currency": "ZMW"
  },
  "action": "flag",        // flag, block, or require_review
  "severity": "high"
}

// Check transaction risk score
GET /v1/payments/pay_abc123/risk
// → { "risk_score": 15, "factors": ["new_customer", "high_amount"] }`} />
                    </CardContent>
                  </Card>
                </div>
              )}


              {activeSection === "pagination" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Pagination</h2>
                    <p className="text-muted-foreground">Efficiently navigate large result sets with cursor-based pagination</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Cursor-Based Pagination</CardTitle>
                      <CardDescription>More reliable than offset pagination for real-time data</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <CodeBlock code={`// First page
GET /v1/payments?limit=25

// Response includes pagination cursors
{
  "data": [...],
  "has_more": true,
  "next_cursor": "pay_xyz789",
  "total_count": 1247
}

// Next page
GET /v1/payments?limit=25&starting_after=pay_xyz789

// Previous page  
GET /v1/payments?limit=25&ending_before=pay_abc123`} />

                      <h4 className="font-medium text-sm mt-4">Parameters</h4>
                      <div className="space-y-2">
                        {[
                          { param: "limit", desc: "Number of items per page (1-100, default 25)" },
                          { param: "starting_after", desc: "Cursor for next page (ID of last item)" },
                          { param: "ending_before", desc: "Cursor for previous page (ID of first item)" },
                          { param: "created[gte]", desc: "Filter by creation date (>=)" },
                          { param: "created[lte]", desc: "Filter by creation date (<=)" },
                          { param: "status", desc: "Filter by status (completed, pending, failed)" },
                        ].map((p) => (
                          <div key={p.param} className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
                            <code className="text-xs font-mono text-primary font-semibold">{p.param}</code>
                            <span className="text-xs text-muted-foreground">{p.desc}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* TESTING */}
              {activeSection === "testing" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Testing Guide</h2>
                    <p className="text-muted-foreground">Test your integration thoroughly before going live</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Sandbox Environment</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                        <div className="bg-muted/50 rounded-lg px-4 py-3">
                          <p className="text-[10px] text-muted-foreground uppercase mb-0.5">Base URL</p>
                          <code className="text-sm font-mono">https://api.sandbox.bmaglasspay.com/v1</code>
                        </div>
                        <div className="bg-muted/50 rounded-lg px-4 py-3">
                          <p className="text-[10px] text-muted-foreground uppercase mb-0.5">API Key Prefix</p>
                          <code className="text-sm font-mono">pk_test_*</code>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        The sandbox environment mirrors production exactly but processes no real money. 
                        All webhook events, API responses, and dashboard data work identically.
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Test Cards</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {[
                          { number: "4242 4242 4242 4242", result: "Always succeeds", badge: "default" as const },
                          { number: "4000 0000 0000 0002", result: "Always declined", badge: "destructive" as const },
                          { number: "4000 0027 6000 3184", result: "Requires 3D Secure", badge: "secondary" as const },
                          { number: "4000 0000 0000 9995", result: "Insufficient funds", badge: "destructive" as const },
                          { number: "4000 0000 0000 0119", result: "Network error", badge: "destructive" as const },
                          { number: "4000 0000 0000 3220", result: "Processing error", badge: "destructive" as const },
                        ].map((card) => (
                          <div key={card.number} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                            <code className="text-sm font-mono">{card.number}</code>
                            <Badge variant={card.badge} className="text-xs">{card.result}</Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Test Mobile Money Numbers</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {[
                          { number: "+260970000001", provider: "MTN", result: "Success", badge: "default" as const },
                          { number: "+260960000001", provider: "Airtel", result: "Success", badge: "default" as const },
                          { number: "+260950000001", provider: "Zamtel", result: "Success", badge: "default" as const },
                          { number: "+260970000099", provider: "MTN", result: "Timeout", badge: "secondary" as const },
                          { number: "+260960000099", provider: "Airtel", result: "Declined", badge: "destructive" as const },
                          { number: "+260970000055", provider: "MTN", result: "Insufficient balance", badge: "destructive" as const },
                        ].map((mm) => (
                          <div key={mm.number} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                            <div className="flex items-center gap-3">
                              <code className="text-sm font-mono">{mm.number}</code>
                              <Badge variant="outline" className="text-[10px]">{mm.provider}</Badge>
                            </div>
                            <Badge variant={mm.badge} className="text-xs">{mm.result}</Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Go-Live Checklist</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {[
                          "Switch from pk_test_ to pk_live_ API keys",
                          "Update base URL to production",
                          "Set up production webhook endpoint with HTTPS",
                          "Implement idempotency keys for all payment creation",
                          "Add proper error handling for all error types",
                          "Test webhook signature verification",
                          "Set up monitoring and alerting for failed payments",
                          "Complete KYC/KYB verification for your merchant account",
                          "Review rate limits for your plan",
                          "Enable 3D Secure for card payments",
                        ].map((item, i) => (
                          <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                            <div className="w-5 h-5 rounded border-2 border-muted-foreground/30 flex items-center justify-center shrink-0">
                              <span className="text-[10px] text-muted-foreground">{i + 1}</span>
                            </div>
                            <span className="text-sm text-muted-foreground">{item}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* PLAYGROUND */}
              {activeSection === "playground" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">API Playground</h2>
                    <p className="text-muted-foreground">Test API endpoints interactively with instant mock responses</p>
                  </div>
                  <ApiPlayground />
                </div>
              )}

              {/* MIGRATION GUIDE */}
              {activeSection === "migration" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Migration Guide</h2>
                    <p className="text-muted-foreground">Switch from other payment providers to BMaGlass Pay</p>
                  </div>

                  {[
                    {
                      provider: "PayPal",
                      steps: [
                        "Replace PayPal client SDK with @bmaglass/payments-js",
                        "Map PayPal order IDs to BMaGlass payment IDs in your database",
                        "Update webhook endpoints from PayPal events to BMaGlass events",
                        "Replace PayPal buttons with BMaGlass Drop-in Checkout",
                        "Update refund logic — BMaGlass supports partial refunds natively",
                        "Migrate recurring billing from PayPal Subscriptions to BMaGlass Subscriptions",
                      ],
                      codeMap: [
                        { from: "paypal.orders.create()", to: "bmaglass.payments.create()" },
                        { from: "paypal.orders.capture()", to: "bmaglass.payments.capture()" },
                        { from: "CHECKOUT.ORDER.APPROVED", to: "payment.completed" },
                        { from: "paypal.subscriptions.create()", to: "bmaglass.subscriptions.create()" },
                      ]
                    },
                    {
                      provider: "Stripe",
                      steps: [
                        "Replace stripe SDK with @bmaglass/payments-js",
                        "Map Stripe PaymentIntent IDs to BMaGlass payment IDs",
                        "Update webhook signatures from Stripe to BMaGlass format",
                        "Replace Stripe Elements with BMaGlass Drop-in UI",
                        "Migrate Stripe Customers to BMaGlass Customers API",
                        "Update subscription billing from Stripe to BMaGlass",
                      ],
                      codeMap: [
                        { from: "stripe.paymentIntents.create()", to: "bmaglass.payments.create()" },
                        { from: "stripe.customers.create()", to: "bmaglass.customers.create()" },
                        { from: "payment_intent.succeeded", to: "payment.completed" },
                        { from: "stripe.webhooks.construct()", to: "bmaglass.webhooks.verify()" },
                      ]
                    },
                    {
                      provider: "Flutterwave / Paystack",
                      steps: [
                        "Replace payment initialization with BMaGlass API",
                        "Update callback URLs and webhook endpoints",
                        "Mobile Money integration works the same way — just update the API",
                        "Replace inline.js with BMaGlass checkout.js",
                        "Update transfer/payout endpoints",
                        "Migrate virtual card issuance to BMaGlass Cards API",
                      ],
                      codeMap: [
                        { from: "flw.charge.card()", to: "bmaglass.payments.create()" },
                        { from: "paystack.transaction.initialize()", to: "bmaglass.payments.create()" },
                        { from: "charge.completed", to: "payment.completed" },
                        { from: "flw.transfer.initiate()", to: "bmaglass.transfers.create()" },
                      ]
                    }
                  ].map((migration) => (
                    <Card key={migration.provider} className="border-0 shadow-sm">
                      <CardHeader>
                        <CardTitle className="text-lg">Migrating from {migration.provider}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          {migration.steps.map((step, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</div>
                              {step}
                            </div>
                          ))}
                        </div>
                        <Separator />
                        <h4 className="font-medium text-sm">API Mapping</h4>
                        <div className="space-y-2">
                          {migration.codeMap.map((map) => (
                            <div key={map.from} className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg text-xs font-mono">
                              <span className="text-muted-foreground line-through">{map.from}</span>
                              <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                              <span className="text-primary font-semibold">{map.to}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* CHANGELOG */}
              {activeSection === "changelog" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">API Changelog</h2>
                    <p className="text-muted-foreground">Track all changes to the BMaGlass Pay API</p>
                  </div>

                  {[
                    {
                      version: "v1.8.0",
                      date: "March 5, 2026",
                      type: "feature" as const,
                      changes: [
                        "Added Payment Links API — create shareable payment links",
                        "Added Batch Payouts API — send money to multiple recipients",
                        "Added Invoice reminder endpoint",
                        "New webhook events: invoice.overdue, payout.completed",
                        "React Native SDK v1.0.0 released",
                      ]
                    },
                    {
                      version: "v1.7.0",
                      date: "February 18, 2026",
                      type: "feature" as const,
                      changes: [
                        "Added Disputes API — manage chargebacks programmatically",
                        "Added subscription pause/resume endpoints",
                        "Ruby SDK v1.3.0 released with Rails integration",
                        "Improved Mobile Money timeout handling",
                      ]
                    },
                    {
                      version: "v1.6.2",
                      date: "February 3, 2026",
                      type: "fix" as const,
                      changes: [
                        "Fixed webhook signature verification edge case with special characters",
                        "Improved rate limit headers accuracy",
                        "Fixed pagination cursor encoding for filtered queries",
                      ]
                    },
                    {
                      version: "v1.6.0",
                      date: "January 20, 2026",
                      type: "feature" as const,
                      changes: [
                        "Added Bitcoin Lightning Network support",
                        "Added QR code payment method",
                        "New Go SDK v1.2.0 with connection pooling",
                        "Added Zapier integration",
                        "Improved sandbox response times by 40%",
                      ]
                    },
                    {
                      version: "v1.5.0",
                      date: "January 5, 2026",
                      type: "feature" as const,
                      changes: [
                        "Added Reporting API — transaction, settlement, and payout reports",
                        "Added CSV/PDF export endpoint",
                        "C# / .NET SDK v1.0.0 released",
                        "Added Shopify plugin (stable)",
                        "Improved idempotency key handling",
                      ]
                    },
                  ].map((release) => (
                    <Card key={release.version} className="border-0 shadow-sm">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <Badge variant={release.type === "feature" ? "default" : "secondary"} className="font-mono text-xs">
                            {release.version}
                          </Badge>
                          <span className="text-sm text-muted-foreground">{release.date}</span>
                          <Badge variant="outline" className="text-[10px] capitalize">{release.type}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {release.changes.map((change, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                              {change}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Developers;
