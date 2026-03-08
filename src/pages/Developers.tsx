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
  Clock, Star, ChevronRight, Search, FileCode, Key, Users, Repeat
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

const PlatformCard = ({ name, icon: Icon, description, status, installCmd, features }: {
  name: string;
  icon: React.ElementType;
  description: string;
  status: "stable" | "beta" | "coming-soon";
  installCmd?: string;
  features: string[];
}) => (
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
        <Button variant="outline" size="sm" className="flex-1 h-8 text-xs">
          <Book className="h-3 w-3 mr-1" /> Docs
        </Button>
        {status !== "coming-soon" && (
          <Button size="sm" className="flex-1 h-8 text-xs">
            <Download className="h-3 w-3 mr-1" /> Install
          </Button>
        )}
      </div>
    </CardContent>
  </Card>
);

const navItems = [
  { id: "quickstart", label: "Quick Start", icon: Zap },
  { id: "api", label: "API Reference", icon: Terminal },
  { id: "sdks", label: "SDKs & Libraries", icon: Package },
  { id: "plugins", label: "Plugins", icon: Blocks },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "testing", label: "Testing", icon: CreditCard },
  { id: "playground", label: "API Playground", icon: Play },
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
                Accept Mobile Money, cards, and bank transfers with our modern APIs. 
                Get started in minutes with comprehensive SDKs and no-code plugins.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" className="h-12 px-6 rounded-lg" onClick={() => setActiveSection("quickstart")}>
                  <Zap className="h-4 w-4 mr-2" /> Get Started
                </Button>
                <Button size="lg" variant="outline" className="h-12 px-6 rounded-lg" onClick={() => setActiveSection("api")}>
                  <Book className="h-4 w-4 mr-2" /> API Reference
                </Button>
              </div>
            </div>

            {/* Search bar */}
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
              {[
                { label: "API Uptime", value: "99.99%", icon: Shield },
                { label: "Avg Response", value: "89ms", icon: Clock },
                { label: "SDKs", value: "4 Languages", icon: Package },
                { label: "Plugins", value: "8+ Platforms", icon: Plug },
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
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-3">Documentation</p>
              {navItems.map((item) => (
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

              <Separator className="my-4" />

              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-3">Resources</p>
              <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" /> API Status
              </a>
              <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <ExternalLink className="h-4 w-4" /> Changelog
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

                  {/* Quick Start Steps */}
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

                  {/* CMS Tip */}
                  <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="p-4 flex items-start gap-3">
                      <Plug className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">Using a CMS or e-commerce platform?</p>
                        <p className="text-sm text-muted-foreground">
                          Skip the code — install our ready-made plugins for{" "}
                          <button onClick={() => setActiveSection("plugins")} className="text-primary hover:underline">
                            WordPress, WooCommerce, Odoo, Shopify
                          </button>, and more.
                        </p>
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
                    <p className="text-muted-foreground">Complete reference for the BMaGlass Pay REST API</p>
                  </div>

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
  -H "Content-Type: application/json"`} />
                      <p className="text-sm text-muted-foreground mt-3">
                        Use <code className="bg-muted px-1.5 py-0.5 rounded text-xs">pk_test_</code> keys in sandbox and{" "}
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">pk_live_</code> keys in production.
                      </p>
                    </CardContent>
                  </Card>

                  {/* Endpoints */}
                  {[
                    {
                      title: "Payments",
                      icon: CreditCard,
                      desc: "Create, retrieve, and manage payments",
                      endpoints: [
                        { method: "POST", path: "/v1/payments", desc: "Create a payment" },
                        { method: "GET", path: "/v1/payments/:id", desc: "Get payment details" },
                        { method: "GET", path: "/v1/payments", desc: "List all payments" },
                        { method: "POST", path: "/v1/payments/:id/refund", desc: "Refund a payment" },
                      ]
                    },
                    {
                      title: "Transfers",
                      icon: ArrowRight,
                      desc: "Send money to bank accounts or mobile wallets",
                      endpoints: [
                        { method: "POST", path: "/v1/transfers", desc: "Create a transfer" },
                        { method: "GET", path: "/v1/transfers/:id", desc: "Get transfer status" },
                        { method: "GET", path: "/v1/transfers", desc: "List transfers" },
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
                      ]
                    },
                    {
                      title: "Virtual Cards",
                      icon: CreditCard,
                      desc: "Issue and manage virtual payment cards",
                      endpoints: [
                        { method: "POST", path: "/v1/cards", desc: "Create virtual card" },
                        { method: "GET", path: "/v1/cards/:id", desc: "Get card details" },
                        { method: "POST", path: "/v1/cards/:id/fund", desc: "Fund a card" },
                      ]
                    },
                    {
                      title: "Subscriptions",
                      icon: Repeat,
                      desc: "Recurring billing and subscription management",
                      endpoints: [
                        { method: "POST", path: "/v1/subscriptions", desc: "Create subscription" },
                        { method: "GET", path: "/v1/subscriptions/:id", desc: "Get subscription" },
                        { method: "POST", path: "/v1/subscriptions/:id/cancel", desc: "Cancel subscription" },
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
                      <CardTitle className="text-lg">Payment Methods</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[
                          { method: "mobile_money", label: "Mobile Money", providers: "MTN, Airtel, Zamtel" },
                          { method: "card", label: "Card Payments", providers: "Visa, Mastercard" },
                          { method: "bank_transfer", label: "Bank Transfer", providers: "All Zambian banks" },
                          { method: "ussd", label: "USSD", providers: "Feature phone support" },
                          { method: "bitcoin", label: "Bitcoin", providers: "Lightning Network" },
                          { method: "paypal", label: "PayPal", providers: "International payments" },
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
                          { code: "400", desc: "Bad Request" },
                          { code: "401", desc: "Unauthorized" },
                          { code: "403", desc: "Forbidden" },
                          { code: "404", desc: "Not Found" },
                          { code: "422", desc: "Validation Error" },
                          { code: "429", desc: "Rate Limited" },
                          { code: "500", desc: "Server Error" },
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

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Total Downloads", value: "100K+", icon: Download },
                      { label: "Languages", value: "4 SDKs", icon: Package },
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

                  {/* SDK Cards */}
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
    onSuccess: (payment) => console.log('Paid:', payment.id)
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
                    <PlatformCard
                      name="WordPress"
                      icon={Globe}
                      description="Payment gateway for WordPress"
                      status="stable"
                      installCmd="Upload bmaglass-pay.zip via Plugins"
                      features={["One-click install", "Donation forms via shortcode", "Gutenberg block", "All payment methods"]}
                    />
                    <PlatformCard
                      name="WooCommerce"
                      icon={ShoppingCart}
                      description="Full checkout integration"
                      status="stable"
                      installCmd="Upload bmaglass-woocommerce.zip"
                      features={["All payment methods at checkout", "Auto order status updates", "Multi-currency support", "Refunds from admin"]}
                    />
                    <PlatformCard
                      name="Odoo"
                      icon={Blocks}
                      description="Payment acquirer for Odoo ERP"
                      status="stable"
                      installCmd="odoo-bin -i bmaglass_payment"
                      features={["Odoo 16 & 17 compatible", "POS integration", "Invoice payment links", "Auto reconciliation"]}
                    />
                    <PlatformCard
                      name="Shopify"
                      icon={Store}
                      description="Shopify payment app"
                      status="beta"
                      features={["Shopify Payments API", "Mobile Money at checkout", "Auto order fulfillment", "Multi-currency"]}
                    />
                    <PlatformCard
                      name="Laravel"
                      icon={Code2}
                      description="First-party PHP package"
                      status="stable"
                      installCmd="composer require bmaglass/laravel-payments"
                      features={["Cashier-style API", "Blade components", "Webhook verification", "Artisan commands"]}
                    />
                    <PlatformCard
                      name="Django"
                      icon={Code2}
                      description="Python Django integration"
                      status="stable"
                      installCmd="pip install bmaglass-django"
                      features={["Django 4.x+", "Template tags", "Signals for events", "Admin dashboard"]}
                    />
                  </div>
                </div>
              )}

              {/* WEBHOOKS */}
              {activeSection === "webhooks" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Webhooks</h2>
                    <p className="text-muted-foreground">Receive real-time notifications for payment events</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Webhook Events</CardTitle>
                      <CardDescription>Subscribe to events that matter to your application</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {[
                          "payment.created", "payment.completed", "payment.failed", "payment.refunded",
                          "transfer.created", "transfer.completed", "transfer.failed",
                          "subscription.created", "subscription.renewed", "subscription.cancelled",
                          "card.created", "card.funded", "card.transaction"
                        ].map((event) => (
                          <div key={event} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                            <Webhook className="h-3.5 w-3.5 text-primary" />
                            <code className="text-xs font-mono">{event}</code>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Signature Verification</CardTitle>
                      <CardDescription>Always verify webhook signatures to ensure authenticity</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <CodeBlock code={`import crypto from 'crypto';

function verifyWebhook(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}`} />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* TESTING */}
              {activeSection === "testing" && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Testing & Sandbox</h2>
                    <p className="text-muted-foreground">Test your integration with our sandbox environment</p>
                  </div>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Test Credentials</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {[
                          { label: "MTN Mobile Money", number: "+260970000001", pin: "1234" },
                          { label: "Airtel Money", number: "+260960000001", pin: "1234" },
                          { label: "Zamtel Kwacha", number: "+260950000001", pin: "1234" },
                        ].map((cred) => (
                          <div key={cred.label} className="p-4 rounded-lg bg-muted/50 border border-border/50">
                            <p className="font-medium text-sm mb-2">{cred.label}</p>
                            <p className="text-xs text-muted-foreground">Phone: <code className="text-foreground">{cred.number}</code></p>
                            <p className="text-xs text-muted-foreground">PIN: <code className="text-foreground">{cred.pin}</code></p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-lg">Test Cards</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {[
                          { number: "4242 4242 4242 4242", result: "Success" },
                          { number: "4000 0000 0000 0002", result: "Declined" },
                          { number: "4000 0000 0000 9995", result: "Insufficient funds" },
                        ].map((card) => (
                          <div key={card.number} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                            <code className="text-sm font-mono">{card.number}</code>
                            <Badge variant={card.result === "Success" ? "default" : "secondary"} className="text-xs">
                              {card.result}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* PLAYGROUND */}
              {activeSection === "playground" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">API Playground</h2>
                    <p className="text-muted-foreground">Test API endpoints interactively with live responses</p>
                  </div>
                  <ApiPlayground />
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
