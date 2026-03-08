import React, { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, Copy, Check, Loader2, Clock, ChevronDown, ChevronRight, Code2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  label: string;
  category: string;
  defaultBody?: Record<string, any>;
  pathParams?: string[];
  description: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: "POST", path: "/v1/payments", label: "Create Payment", category: "Payments",
    description: "Create a new payment intent",
    defaultBody: {
      amount: 150.00,
      currency: "ZMW",
      payment_method: "mobile_money",
      customer: { phone: "+260970000001", name: "John Banda" },
      description: "Test order #1234",
      callback_url: "https://yoursite.com/webhook"
    }
  },
  {
    method: "GET", path: "/v1/payments/:id", label: "Get Payment", category: "Payments",
    description: "Retrieve payment details by ID",
    pathParams: ["id"],
  },
  {
    method: "GET", path: "/v1/payments", label: "List Payments", category: "Payments",
    description: "List all payments with pagination",
  },
  {
    method: "POST", path: "/v1/payments/:id/refund", label: "Refund Payment", category: "Payments",
    description: "Refund a completed payment",
    pathParams: ["id"],
    defaultBody: { amount: 50.00, reason: "Customer request" }
  },
  {
    method: "POST", path: "/v1/transfers", label: "Create Transfer", category: "Transfers",
    description: "Send money to a mobile wallet or bank account",
    defaultBody: {
      amount: 200.00,
      currency: "ZMW",
      destination: { type: "mobile_money", phone: "+260960000001", provider: "airtel" },
      description: "Payout to supplier"
    }
  },
  {
    method: "GET", path: "/v1/transfers/:id", label: "Get Transfer", category: "Transfers",
    description: "Check transfer status",
    pathParams: ["id"],
  },
  {
    method: "POST", path: "/v1/customers", label: "Create Customer", category: "Customers",
    description: "Create a new customer record",
    defaultBody: {
      name: "Jane Mwale",
      email: "jane@example.com",
      phone: "+260971234567",
      metadata: { plan: "premium" }
    }
  },
  {
    method: "GET", path: "/v1/customers/:id", label: "Get Customer", category: "Customers",
    description: "Retrieve customer details",
    pathParams: ["id"],
  },
  {
    method: "POST", path: "/v1/cards", label: "Create Virtual Card", category: "Virtual Cards",
    description: "Issue a new virtual card",
    defaultBody: {
      currency: "ZMW",
      name: "Marketing Budget",
      type: "single_use",
      spending_limit: 1000.00
    }
  },
  {
    method: "POST", path: "/v1/cards/:id/fund", label: "Fund Card", category: "Virtual Cards",
    description: "Add funds to a virtual card",
    pathParams: ["id"],
    defaultBody: { amount: 500.00, currency: "ZMW" }
  },
  {
    method: "POST", path: "/v1/subscriptions", label: "Create Subscription", category: "Subscriptions",
    description: "Set up recurring billing",
    defaultBody: {
      customer_id: "cus_abc123",
      plan_id: "plan_monthly_pro",
      payment_method: "mobile_money",
      customer: { phone: "+260970000001" }
    }
  },
];

const MOCK_RESPONSES: Record<string, (body?: any, params?: Record<string, string>) => { status: number; body: any; latency: number }> = {
  "POST /v1/payments": (body) => ({
    status: 201,
    latency: 245,
    body: {
      id: "pay_" + Math.random().toString(36).slice(2, 14),
      object: "payment",
      amount: body?.amount || 150,
      currency: body?.currency || "ZMW",
      status: "pending",
      payment_method: body?.payment_method || "mobile_money",
      customer: body?.customer || { phone: "+260970000001" },
      description: body?.description || "Test payment",
      checkout_url: "https://checkout.bmaglasspay.com/pay/cs_sandbox_" + Math.random().toString(36).slice(2, 10),
      created_at: new Date().toISOString(),
      metadata: {},
      livemode: false,
    }
  }),
  "GET /v1/payments/:id": (_b, params) => ({
    status: 200,
    latency: 89,
    body: {
      id: params?.id || "pay_abc123def456",
      object: "payment",
      amount: 150.00,
      currency: "ZMW",
      status: "completed",
      payment_method: "mobile_money",
      customer: { phone: "+260970000001", name: "John Banda" },
      completed_at: new Date().toISOString(),
      created_at: new Date(Date.now() - 120000).toISOString(),
      fee: { amount: 3.75, currency: "ZMW" },
      livemode: false,
    }
  }),
  "GET /v1/payments": () => ({
    status: 200,
    latency: 132,
    body: {
      object: "list",
      data: [
        { id: "pay_" + Math.random().toString(36).slice(2, 10), amount: 150, currency: "ZMW", status: "completed", created_at: new Date().toISOString() },
        { id: "pay_" + Math.random().toString(36).slice(2, 10), amount: 320, currency: "ZMW", status: "pending", created_at: new Date(Date.now() - 3600000).toISOString() },
        { id: "pay_" + Math.random().toString(36).slice(2, 10), amount: 75, currency: "ZMW", status: "failed", created_at: new Date(Date.now() - 7200000).toISOString() },
      ],
      has_more: true,
      total_count: 47,
      url: "/v1/payments",
    }
  }),
  "POST /v1/payments/:id/refund": (_b, params) => ({
    status: 200,
    latency: 310,
    body: {
      id: "ref_" + Math.random().toString(36).slice(2, 14),
      object: "refund",
      payment_id: params?.id || "pay_abc123",
      amount: _b?.amount || 50,
      currency: "ZMW",
      status: "processing",
      reason: _b?.reason || "Customer request",
      created_at: new Date().toISOString(),
      livemode: false,
    }
  }),
  "POST /v1/transfers": (body) => ({
    status: 201,
    latency: 198,
    body: {
      id: "tr_" + Math.random().toString(36).slice(2, 14),
      object: "transfer",
      amount: body?.amount || 200,
      currency: body?.currency || "ZMW",
      status: "processing",
      destination: body?.destination || { type: "mobile_money", phone: "+260960000001" },
      estimated_arrival: new Date(Date.now() + 300000).toISOString(),
      created_at: new Date().toISOString(),
      livemode: false,
    }
  }),
  "GET /v1/transfers/:id": (_b, params) => ({
    status: 200,
    latency: 76,
    body: {
      id: params?.id || "tr_abc123",
      object: "transfer",
      amount: 200,
      currency: "ZMW",
      status: "completed",
      destination: { type: "mobile_money", phone: "+260960000001", provider: "airtel" },
      completed_at: new Date().toISOString(),
      created_at: new Date(Date.now() - 600000).toISOString(),
      livemode: false,
    }
  }),
  "POST /v1/customers": (body) => ({
    status: 201,
    latency: 112,
    body: {
      id: "cus_" + Math.random().toString(36).slice(2, 14),
      object: "customer",
      name: body?.name || "Jane Mwale",
      email: body?.email || "jane@example.com",
      phone: body?.phone || "+260971234567",
      metadata: body?.metadata || {},
      created_at: new Date().toISOString(),
      livemode: false,
    }
  }),
  "GET /v1/customers/:id": (_b, params) => ({
    status: 200,
    latency: 65,
    body: {
      id: params?.id || "cus_abc123",
      object: "customer",
      name: "Jane Mwale",
      email: "jane@example.com",
      phone: "+260971234567",
      total_spent: 2450.00,
      transactions_count: 12,
      created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
      livemode: false,
    }
  }),
  "POST /v1/cards": (body) => ({
    status: 201,
    latency: 287,
    body: {
      id: "card_" + Math.random().toString(36).slice(2, 14),
      object: "virtual_card",
      masked_number: "**** **** **** " + Math.floor(1000 + Math.random() * 9000),
      currency: body?.currency || "ZMW",
      name: body?.name || "Marketing Budget",
      type: body?.type || "single_use",
      balance: 0,
      spending_limit: body?.spending_limit || 1000,
      status: "active",
      expiry_date: "12/28",
      created_at: new Date().toISOString(),
      livemode: false,
    }
  }),
  "POST /v1/cards/:id/fund": (_b, params) => ({
    status: 200,
    latency: 156,
    body: {
      id: params?.id || "card_abc123",
      object: "virtual_card",
      balance: _b?.amount || 500,
      currency: _b?.currency || "ZMW",
      funded_amount: _b?.amount || 500,
      status: "active",
      updated_at: new Date().toISOString(),
      livemode: false,
    }
  }),
  "POST /v1/subscriptions": (body) => ({
    status: 201,
    latency: 334,
    body: {
      id: "sub_" + Math.random().toString(36).slice(2, 14),
      object: "subscription",
      customer_id: body?.customer_id || "cus_abc123",
      plan_id: body?.plan_id || "plan_monthly_pro",
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 86400000 * 30).toISOString(),
      payment_method: body?.payment_method || "mobile_money",
      created_at: new Date().toISOString(),
      livemode: false,
    }
  }),
};

const methodColors: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  POST: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  PUT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  DELETE: "bg-red-500/15 text-red-400 border-red-500/30",
};

type CodeLang = "curl" | "javascript" | "python" | "php" | "java" | "go" | "ruby" | "csharp";

const CODE_LANGS: { id: CodeLang; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "php", label: "PHP" },
  { id: "java", label: "Java" },
  { id: "go", label: "Go" },
  { id: "ruby", label: "Ruby" },
  { id: "csharp", label: "C#" },
];

function generateCode(
  lang: CodeLang,
  method: string,
  url: string,
  apiKey: string,
  body?: string
): string {
  let parsedBody: any = null;
  try { if (body) parsedBody = JSON.parse(body); } catch { /* skip */ }
  const hasBody = parsedBody && method !== "GET" && Object.keys(parsedBody).length > 0;
  const bodyJson = hasBody ? JSON.stringify(parsedBody, null, 2) : "";
  const bodyJsonOneline = hasBody ? JSON.stringify(parsedBody) : "";

  switch (lang) {
    case "curl": {
      let cmd = `curl -X ${method} "${url}" \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json"`;
      if (hasBody) cmd += ` \\\n  -d '${bodyJsonOneline}'`;
      return cmd;
    }
    case "javascript":
      return `const response = await fetch("${url}", {
  method: "${method}",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json",
  },${hasBody ? `\n  body: JSON.stringify(${bodyJson}),` : ""}
});

const data = await response.json();
console.log(data);`;

    case "python":
      return `import requests

response = requests.${method.toLowerCase()}(
    "${url}",
    headers={
        "Authorization": "Bearer ${apiKey}",
        "Content-Type": "application/json",
    },${hasBody ? `\n    json=${bodyJson.replace(/"/g, '"').replace(/null/g, 'None').replace(/true/g, 'True').replace(/false/g, 'False')},` : ""}
)

data = response.json()
print(data)`;

    case "php":
      return `<?php
$ch = curl_init();

curl_setopt_array($ch, [
    CURLOPT_URL => "${url}",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => "${method}",
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer ${apiKey}",
        "Content-Type: application/json",
    ],${hasBody ? `\n    CURLOPT_POSTFIELDS => json_encode(${bodyJson.replace(/"/g, "'")}),` : ""}
]);

$response = curl_exec($ch);
curl_close($ch);

$data = json_decode($response, true);
print_r($data);`;

    case "java":
      return `import java.net.http.*;
import java.net.URI;

HttpClient client = HttpClient.newHttpClient();

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("${url}"))
    .header("Authorization", "Bearer ${apiKey}")
    .header("Content-Type", "application/json")
    .method("${method}", ${hasBody
      ? `HttpRequest.BodyPublishers.ofString("${bodyJsonOneline.replace(/"/g, '\\"')}")`
      : `HttpRequest.BodyPublishers.noBody()`})
    .build();

HttpResponse<String> response = client.send(
    request, HttpResponse.BodyHandlers.ofString()
);

System.out.println(response.body());`;

    case "go":
      return `package main

import (
    "fmt"
    "io"
    "net/http"${hasBody ? '\n    "strings"' : ""}
)

func main() {
    ${hasBody ? `body := strings.NewReader(\`${bodyJsonOneline}\`)
    req, _ := http.NewRequest("${method}", "${url}", body)` : `req, _ := http.NewRequest("${method}", "${url}", nil)`}
    req.Header.Set("Authorization", "Bearer ${apiKey}")
    req.Header.Set("Content-Type", "application/json")

    resp, _ := http.DefaultClient.Do(req)
    defer resp.Body.Close()

    data, _ := io.ReadAll(resp.Body)
    fmt.Println(string(data))
}`;

    case "ruby":
      return `require "net/http"
require "json"
require "uri"

uri = URI.parse("${url}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::${method === "GET" ? "Get" : method === "POST" ? "Post" : method === "PUT" ? "Put" : "Delete"}.new(uri.request_uri)
request["Authorization"] = "Bearer ${apiKey}"
request["Content-Type"] = "application/json"${hasBody ? `\nrequest.body = '${bodyJsonOneline}'` : ""}

response = http.request(request)
puts JSON.parse(response.body)`;

    case "csharp":
      return `using System.Net.Http;
using System.Text;

var client = new HttpClient();
client.DefaultRequestHeaders.Add("Authorization", "Bearer ${apiKey}");

${hasBody
  ? `var content = new StringContent(
    @"${bodyJsonOneline.replace(/"/g, '""')}",
    Encoding.UTF8, "application/json"
);

var response = await client.${method === "POST" ? "PostAsync" : method === "PUT" ? "PutAsync" : "SendAsync"}(
    "${url}", content
);`
  : `var response = await client.${method === "GET" ? "GetAsync" : "DeleteAsync"}("${url}");`}

var data = await response.Content.ReadAsStringAsync();
Console.WriteLine(data);`;

    default:
      return "";
  }
}

export function ApiPlayground() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>(ENDPOINTS[0]);
  const [apiKey, setApiKey] = useState("pk_test_sandbox_demo_key");
  const [requestBody, setRequestBody] = useState(JSON.stringify(ENDPOINTS[0].defaultBody || {}, null, 2));
  const [pathParamValues, setPathParamValues] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<{ status: number; body: any; latency: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ endpoint: Endpoint; response: { status: number; body: any; latency: number }; timestamp: Date }>>([]);
  const [copied, setCopied] = useState(false);
  const [codeLang, setCodeLang] = useState<CodeLang>("javascript");
  const [codeCopied, setCodeCopied] = useState(false);
  const [showCodeGen, setShowCodeGen] = useState(false);
  const { toast } = useToast();

  const handleEndpointChange = useCallback((value: string) => {
    const ep = ENDPOINTS.find(e => `${e.method} ${e.path}` === value);
    if (ep) {
      setSelectedEndpoint(ep);
      setRequestBody(JSON.stringify(ep.defaultBody || {}, null, 2));
      setPathParamValues({});
      setResponse(null);
    }
  }, []);

  const resolvedPath = selectedEndpoint.path.replace(/:(\w+)/g, (_, param) => pathParamValues[param] || `:${param}`);

  const generateCurl = () => {
    const url = `https://api.sandbox.bmaglasspay.com${resolvedPath}`;
    let cmd = `curl -X ${selectedEndpoint.method} "${url}" \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json"`;
    if (selectedEndpoint.defaultBody && selectedEndpoint.method !== "GET") {
      try {
        const body = JSON.parse(requestBody);
        cmd += ` \\\n  -d '${JSON.stringify(body)}'`;
      } catch { /* skip */ }
    }
    return cmd;
  };

  const sendRequest = async () => {
    setLoading(true);
    setResponse(null);

    // Simulate network latency
    const lookupKey = `${selectedEndpoint.method} ${selectedEndpoint.path}`;
    const handler = MOCK_RESPONSES[lookupKey];

    await new Promise(r => setTimeout(r, 400 + Math.random() * 600));

    let body: any = {};
    try { body = JSON.parse(requestBody); } catch { /* empty */ }

    const res = handler
      ? handler(body, pathParamValues)
      : { status: 200, latency: Math.floor(80 + Math.random() * 200), body: { message: "Sandbox response" } };

    setResponse(res);
    setHistory(prev => [{ endpoint: selectedEndpoint, response: res, timestamp: new Date() }, ...prev.slice(0, 9)]);
    setLoading(false);
  };

  const copyCurl = () => {
    navigator.clipboard.writeText(generateCurl());
    setCopied(true);
    toast({ title: "cURL copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const categories = [...new Set(ENDPOINTS.map(e => e.category))];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Play className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>API Playground</CardTitle>
              <CardDescription>Make test API calls directly from your browser — no code required</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 p-3 bg-accent/30 rounded-lg border border-accent text-sm">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">Sandbox</Badge>
            <span className="text-muted-foreground">All requests are simulated — no real payments are processed.</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Request Builder */}
        <div className="lg:col-span-3 space-y-4">
          {/* API Key */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <Label className="text-xs text-muted-foreground mb-1.5 block">API Key</Label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono text-sm"
                placeholder="pk_test_..."
              />
            </CardContent>
          </Card>

          {/* Endpoint Selector */}
          <Card>
            <CardContent className="pt-4 pb-4 space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Endpoint</Label>
                <Select value={`${selectedEndpoint.method} ${selectedEndpoint.path}`} onValueChange={handleEndpointChange}>
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <React.Fragment key={cat}>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{cat}</div>
                        {ENDPOINTS.filter(e => e.category === cat).map(ep => (
                          <SelectItem key={`${ep.method} ${ep.path}`} value={`${ep.method} ${ep.path}`}>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${methodColors[ep.method]}`}>
                                {ep.method}
                              </span>
                              <span className="font-mono text-xs">{ep.path}</span>
                              <span className="text-muted-foreground text-xs ml-1">— {ep.label}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </React.Fragment>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="text-sm text-muted-foreground">{selectedEndpoint.description}</p>

              {/* URL preview */}
              <div className="flex items-center gap-2 p-2.5 bg-secondary/20 rounded-lg border font-mono text-sm overflow-x-auto">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border shrink-0 ${methodColors[selectedEndpoint.method]}`}>
                  {selectedEndpoint.method}
                </span>
                <span className="text-muted-foreground">https://api.sandbox.bmaglasspay.com</span>
                <span className="text-foreground">{resolvedPath}</span>
              </div>

              {/* Path params */}
              {selectedEndpoint.pathParams && selectedEndpoint.pathParams.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Path Parameters</Label>
                  {selectedEndpoint.pathParams.map(param => (
                    <div key={param} className="flex items-center gap-2">
                      <Label className="text-sm font-mono w-16 shrink-0">{param}</Label>
                      <Input
                        value={pathParamValues[param] || ""}
                        onChange={(e) => setPathParamValues(prev => ({ ...prev, [param]: e.target.value }))}
                        placeholder={`e.g. pay_abc123`}
                        className="font-mono text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Request Body */}
          {selectedEndpoint.defaultBody && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Request Body</CardTitle>
              </CardHeader>
              <CardContent>
                <textarea
                  value={requestBody}
                  onChange={(e) => setRequestBody(e.target.value)}
                  className="w-full min-h-[200px] bg-secondary/20 border rounded-lg p-4 font-mono text-sm text-foreground resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />
              </CardContent>
            </Card>
          )}

          {/* Send + cURL */}
          <div className="flex gap-3">
            <Button onClick={sendRequest} disabled={loading} className="flex-1" size="lg">
              {loading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...</>
              ) : (
                <><Play className="h-4 w-4 mr-2" /> Send Request</>
              )}
            </Button>
            <Button variant="outline" size="lg" onClick={copyCurl}>
              {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              cURL
            </Button>
          </div>

          {/* Code Generation */}
          <Card>
            <CardHeader className="pb-2">
              <button
                onClick={() => setShowCodeGen(!showCodeGen)}
                className="flex items-center justify-between w-full"
              >
                <div className="flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm">Generated Code</CardTitle>
                </div>
                {showCodeGen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
            </CardHeader>
            {showCodeGen && (
              <CardContent>
                <Tabs value={codeLang} onValueChange={(v) => setCodeLang(v as CodeLang)}>
                  <TabsList className="w-full flex flex-wrap h-auto gap-0.5 bg-muted/50 p-0.5 mb-3">
                    {CODE_LANGS.map(l => (
                      <TabsTrigger key={l.id} value={l.id} className="text-xs px-2 py-1">
                        {l.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {CODE_LANGS.map(l => (
                    <TabsContent key={l.id} value={l.id}>
                      <div className="relative group">
                        <pre className="bg-secondary/20 border rounded-lg p-4 overflow-x-auto text-xs font-mono text-foreground max-h-[400px]">
                          <code>{generateCode(
                            l.id,
                            selectedEndpoint.method,
                            `https://api.sandbox.bmaglasspay.com${resolvedPath}`,
                            apiKey,
                            requestBody
                          )}</code>
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => {
                            navigator.clipboard.writeText(generateCode(
                              l.id,
                              selectedEndpoint.method,
                              `https://api.sandbox.bmaglasspay.com${resolvedPath}`,
                              apiKey,
                              requestBody
                            ));
                            setCodeCopied(true);
                            toast({ title: `${l.label} code copied` });
                            setTimeout(() => setCodeCopied(false), 2000);
                          }}
                        >
                          {codeCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Right: Response + History */}
        <div className="lg:col-span-2 space-y-4">
          {/* Response */}
          <Card className="sticky top-24">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Response</CardTitle>
                {response && (
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        response.status < 300
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : response.status < 500
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          : "bg-red-500/10 text-red-400 border-red-500/30"
                      }
                    >
                      {response.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {response.latency}ms
                    </span>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : response ? (
                <pre className="bg-secondary/20 border rounded-lg p-4 overflow-auto text-xs font-mono text-foreground max-h-[500px]">
                  {JSON.stringify(response.body, null, 2)}
                </pre>
              ) : (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                  <Play className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Click "Send Request" to see the response</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* History */}
          {history.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent Requests</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSelectedEndpoint(h.endpoint);
                      setRequestBody(JSON.stringify(h.endpoint.defaultBody || {}, null, 2));
                      setResponse(h.response);
                    }}
                    className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-accent/30 transition-colors text-left"
                  >
                    <span className={`text-[10px] font-bold px-1 py-0.5 rounded border ${methodColors[h.endpoint.method]}`}>
                      {h.endpoint.method}
                    </span>
                    <span className="font-mono text-xs text-foreground truncate flex-1">{h.endpoint.path}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        h.response.status < 300
                          ? "text-emerald-400 border-emerald-500/30"
                          : "text-amber-400 border-amber-500/30"
                      }`}
                    >
                      {h.response.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {h.timestamp.toLocaleTimeString()}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
