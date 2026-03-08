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
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  label: string;
  category: string;
  defaultBody?: Record<string, any>;
  pathParams?: string[];
  description: string;
}

const ENDPOINTS: Endpoint[] = [
  // Payments
  { method: "POST", path: "/v1/payments", label: "Create Payment", category: "Payments",
    description: "Create a new payment intent",
    defaultBody: { amount: 150.00, currency: "ZMW", payment_method: "mobile_money", customer: { phone: "+260970000001", name: "John Banda" }, description: "Test order #1234", callback_url: "https://yoursite.com/webhook" } },
  { method: "GET", path: "/v1/payments/:id", label: "Get Payment", category: "Payments", description: "Retrieve payment details by ID", pathParams: ["id"] },
  { method: "GET", path: "/v1/payments", label: "List Payments", category: "Payments", description: "List all payments with pagination" },
  { method: "POST", path: "/v1/payments/:id/refund", label: "Refund Payment", category: "Payments", description: "Refund a completed payment", pathParams: ["id"], defaultBody: { amount: 50.00, reason: "Customer request" } },
  { method: "POST", path: "/v1/payments/:id/capture", label: "Capture Payment", category: "Payments", description: "Capture an authorized payment", pathParams: ["id"] },
  
  // Payment Links
  { method: "POST", path: "/v1/payment-links", label: "Create Payment Link", category: "Payment Links",
    description: "Create a shareable payment link",
    defaultBody: { amount: 250.00, currency: "ZMW", description: "Invoice #5678", expires_in: 86400, reusable: false, redirect_url: "https://yoursite.com/thank-you" } },
  { method: "GET", path: "/v1/payment-links", label: "List Payment Links", category: "Payment Links", description: "List all payment links" },
  
  // Transfers & Payouts
  { method: "POST", path: "/v1/transfers", label: "Create Transfer", category: "Transfers",
    description: "Send money to a mobile wallet or bank account",
    defaultBody: { amount: 200.00, currency: "ZMW", destination: { type: "mobile_money", phone: "+260960000001", provider: "airtel" }, description: "Payout to supplier" } },
  { method: "GET", path: "/v1/transfers/:id", label: "Get Transfer", category: "Transfers", description: "Check transfer status", pathParams: ["id"] },
  { method: "POST", path: "/v1/payouts/batch", label: "Batch Payout", category: "Transfers",
    description: "Send money to multiple recipients at once",
    defaultBody: { currency: "ZMW", items: [
      { amount: 100.00, destination: { type: "mobile_money", phone: "+260970000001", provider: "mtn" }, reference: "salary_jan_001" },
      { amount: 150.00, destination: { type: "mobile_money", phone: "+260960000002", provider: "airtel" }, reference: "salary_jan_002" },
    ]} },
  
  // Invoices
  { method: "POST", path: "/v1/invoices", label: "Create Invoice", category: "Invoices",
    description: "Create a new invoice",
    defaultBody: { customer_email: "jane@example.com", customer_name: "Jane Mwale", currency: "ZMW", items: [{ description: "Web Development", quantity: 1, unit_price: 5000.00 }, { description: "Hosting (1 year)", quantity: 1, unit_price: 1200.00 }], due_date: "2026-04-08", notes: "Payment due within 30 days" } },
  { method: "GET", path: "/v1/invoices/:id", label: "Get Invoice", category: "Invoices", description: "Retrieve invoice details", pathParams: ["id"] },
  { method: "POST", path: "/v1/invoices/:id/send", label: "Send Invoice", category: "Invoices", description: "Send invoice to customer email", pathParams: ["id"] },
  
  // Customers
  { method: "POST", path: "/v1/customers", label: "Create Customer", category: "Customers",
    description: "Create a new customer record",
    defaultBody: { name: "Jane Mwale", email: "jane@example.com", phone: "+260971234567", metadata: { plan: "premium" } } },
  { method: "GET", path: "/v1/customers/:id", label: "Get Customer", category: "Customers", description: "Retrieve customer details", pathParams: ["id"] },
  
  // Virtual Cards
  { method: "POST", path: "/v1/cards", label: "Create Virtual Card", category: "Virtual Cards",
    description: "Issue a new virtual card",
    defaultBody: { currency: "ZMW", name: "Marketing Budget", type: "single_use", spending_limit: 1000.00 } },
  { method: "POST", path: "/v1/cards/:id/fund", label: "Fund Card", category: "Virtual Cards",
    description: "Add funds to a virtual card", pathParams: ["id"], defaultBody: { amount: 500.00, currency: "ZMW" } },
  { method: "POST", path: "/v1/cards/:id/freeze", label: "Freeze Card", category: "Virtual Cards", description: "Temporarily freeze a card", pathParams: ["id"] },
  
  // Subscriptions
  { method: "POST", path: "/v1/subscriptions", label: "Create Subscription", category: "Subscriptions",
    description: "Set up recurring billing",
    defaultBody: { customer_id: "cus_abc123", plan_id: "plan_monthly_pro", payment_method: "mobile_money", customer: { phone: "+260970000001" } } },
  { method: "POST", path: "/v1/subscriptions/:id/cancel", label: "Cancel Subscription", category: "Subscriptions", description: "Cancel a subscription", pathParams: ["id"], defaultBody: { cancel_at_period_end: true } },
  
  // Disputes
  { method: "GET", path: "/v1/disputes", label: "List Disputes", category: "Disputes", description: "List all disputes" },
  { method: "GET", path: "/v1/disputes/:id", label: "Get Dispute", category: "Disputes", description: "Get dispute details", pathParams: ["id"] },
  { method: "POST", path: "/v1/disputes/:id/contest", label: "Contest Dispute", category: "Disputes", description: "Contest a dispute with evidence", pathParams: ["id"],
    defaultBody: { reason: "Service was delivered as described", evidence: { receipt_url: "https://example.com/receipt.pdf", tracking_number: "ZM123456789" } } },
  
  // Reporting
  { method: "GET", path: "/v1/balance", label: "Get Balance", category: "Reporting", description: "Get current account balance" },
  { method: "POST", path: "/v1/reports/export", label: "Export Report", category: "Reporting", description: "Export transactions to CSV/PDF",
    defaultBody: { format: "csv", date_from: "2026-01-01", date_to: "2026-03-08", type: "transactions" } },
];

const MOCK_RESPONSES: Record<string, (body?: any, params?: Record<string, string>) => { status: number; body: any; latency: number }> = {
  "POST /v1/payments": (body) => ({ status: 201, latency: 245,
    body: { id: "pay_" + Math.random().toString(36).slice(2, 14), object: "payment", amount: body?.amount || 150, currency: body?.currency || "ZMW", status: "pending", payment_method: body?.payment_method || "mobile_money", customer: body?.customer || { phone: "+260970000001" }, checkout_url: "https://checkout.bmaglasspay.com/pay/cs_sandbox_" + Math.random().toString(36).slice(2, 10), created_at: new Date().toISOString(), livemode: false } }),
  "GET /v1/payments/:id": (_b, params) => ({ status: 200, latency: 89,
    body: { id: params?.id || "pay_abc123", object: "payment", amount: 150.00, currency: "ZMW", status: "completed", payment_method: "mobile_money", customer: { phone: "+260970000001", name: "John Banda" }, completed_at: new Date().toISOString(), fee: { amount: 3.75, currency: "ZMW" }, livemode: false } }),
  "GET /v1/payments": () => ({ status: 200, latency: 132,
    body: { object: "list", data: [
      { id: "pay_" + Math.random().toString(36).slice(2, 10), amount: 150, currency: "ZMW", status: "completed", created_at: new Date().toISOString() },
      { id: "pay_" + Math.random().toString(36).slice(2, 10), amount: 320, currency: "ZMW", status: "pending", created_at: new Date(Date.now() - 3600000).toISOString() },
    ], has_more: true, next_cursor: "pay_xyz789", total_count: 47 } }),
  "POST /v1/payments/:id/refund": (_b, params) => ({ status: 200, latency: 310,
    body: { id: "ref_" + Math.random().toString(36).slice(2, 14), object: "refund", payment_id: params?.id || "pay_abc123", amount: _b?.amount || 50, currency: "ZMW", status: "processing", reason: _b?.reason || "Customer request", created_at: new Date().toISOString(), livemode: false } }),
  "POST /v1/payments/:id/capture": (_b, params) => ({ status: 200, latency: 180,
    body: { id: params?.id || "pay_abc123", object: "payment", status: "completed", captured: true, captured_at: new Date().toISOString(), livemode: false } }),
  "POST /v1/payment-links": (body) => ({ status: 201, latency: 120,
    body: { id: "plink_" + Math.random().toString(36).slice(2, 14), object: "payment_link", url: "https://pay.bmaglasspay.com/l/" + Math.random().toString(36).slice(2, 8), amount: body?.amount || 250, currency: body?.currency || "ZMW", description: body?.description || "", active: true, expires_at: new Date(Date.now() + (body?.expires_in || 86400) * 1000).toISOString(), created_at: new Date().toISOString(), livemode: false } }),
  "GET /v1/payment-links": () => ({ status: 200, latency: 95,
    body: { object: "list", data: [
      { id: "plink_abc", url: "https://pay.bmaglasspay.com/l/abc123", amount: 250, status: "active", views: 12, payments: 3 },
      { id: "plink_def", url: "https://pay.bmaglasspay.com/l/def456", amount: 500, status: "expired", views: 45, payments: 8 },
    ], has_more: false, total_count: 2 } }),
  "POST /v1/transfers": (body) => ({ status: 201, latency: 198,
    body: { id: "tr_" + Math.random().toString(36).slice(2, 14), object: "transfer", amount: body?.amount || 200, currency: body?.currency || "ZMW", status: "processing", destination: body?.destination, estimated_arrival: new Date(Date.now() + 300000).toISOString(), created_at: new Date().toISOString(), livemode: false } }),
  "GET /v1/transfers/:id": (_b, params) => ({ status: 200, latency: 76,
    body: { id: params?.id || "tr_abc123", object: "transfer", amount: 200, currency: "ZMW", status: "completed", destination: { type: "mobile_money", phone: "+260960000001" }, completed_at: new Date().toISOString(), livemode: false } }),
  "POST /v1/payouts/batch": (body) => ({ status: 201, latency: 420,
    body: { id: "batch_" + Math.random().toString(36).slice(2, 14), object: "batch_payout", status: "processing", total_amount: body?.items?.reduce((s: number, i: any) => s + i.amount, 0) || 250, currency: body?.currency || "ZMW", items_count: body?.items?.length || 2, completed: 0, failed: 0, created_at: new Date().toISOString(), livemode: false } }),
  "POST /v1/invoices": (body) => ({ status: 201, latency: 190,
    body: { id: "inv_" + Math.random().toString(36).slice(2, 14), object: "invoice", invoice_number: "INV-" + Math.floor(100000 + Math.random() * 900000), customer_email: body?.customer_email, customer_name: body?.customer_name, status: "draft", subtotal: body?.items?.reduce((s: number, i: any) => s + i.quantity * i.unit_price, 0) || 6200, tax_amount: 0, total_amount: body?.items?.reduce((s: number, i: any) => s + i.quantity * i.unit_price, 0) || 6200, currency: body?.currency || "ZMW", due_date: body?.due_date, payment_url: "https://pay.bmaglasspay.com/inv/" + Math.random().toString(36).slice(2, 8), created_at: new Date().toISOString(), livemode: false } }),
  "GET /v1/invoices/:id": (_b, params) => ({ status: 200, latency: 78,
    body: { id: params?.id || "inv_abc123", object: "invoice", invoice_number: "INV-000042", status: "sent", total_amount: 6200, currency: "ZMW", customer_name: "Jane Mwale", due_date: "2026-04-08", livemode: false } }),
  "POST /v1/invoices/:id/send": (_b, params) => ({ status: 200, latency: 250,
    body: { id: params?.id || "inv_abc123", object: "invoice", status: "sent", sent_at: new Date().toISOString(), livemode: false } }),
  "POST /v1/customers": (body) => ({ status: 201, latency: 112,
    body: { id: "cus_" + Math.random().toString(36).slice(2, 14), object: "customer", name: body?.name || "Jane Mwale", email: body?.email, phone: body?.phone, metadata: body?.metadata || {}, created_at: new Date().toISOString(), livemode: false } }),
  "GET /v1/customers/:id": (_b, params) => ({ status: 200, latency: 65,
    body: { id: params?.id || "cus_abc123", object: "customer", name: "Jane Mwale", email: "jane@example.com", phone: "+260971234567", total_spent: 2450.00, transactions_count: 12, livemode: false } }),
  "POST /v1/cards": (body) => ({ status: 201, latency: 287,
    body: { id: "card_" + Math.random().toString(36).slice(2, 14), object: "virtual_card", masked_number: "**** **** **** " + Math.floor(1000 + Math.random() * 9000), currency: body?.currency || "ZMW", name: body?.name, type: body?.type || "single_use", balance: 0, spending_limit: body?.spending_limit || 1000, status: "active", created_at: new Date().toISOString(), livemode: false } }),
  "POST /v1/cards/:id/fund": (_b, params) => ({ status: 200, latency: 156,
    body: { id: params?.id || "card_abc123", object: "virtual_card", balance: _b?.amount || 500, funded_amount: _b?.amount || 500, status: "active", livemode: false } }),
  "POST /v1/cards/:id/freeze": (_b, params) => ({ status: 200, latency: 95,
    body: { id: params?.id || "card_abc123", object: "virtual_card", status: "frozen", frozen_at: new Date().toISOString(), livemode: false } }),
  "POST /v1/subscriptions": (body) => ({ status: 201, latency: 334,
    body: { id: "sub_" + Math.random().toString(36).slice(2, 14), object: "subscription", customer_id: body?.customer_id, plan_id: body?.plan_id, status: "active", current_period_end: new Date(Date.now() + 86400000 * 30).toISOString(), livemode: false } }),
  "POST /v1/subscriptions/:id/cancel": (_b, params) => ({ status: 200, latency: 120,
    body: { id: params?.id || "sub_abc123", object: "subscription", status: "cancelled", cancel_at_period_end: _b?.cancel_at_period_end ?? true, cancelled_at: new Date().toISOString(), livemode: false } }),
  "GET /v1/disputes": () => ({ status: 200, latency: 110,
    body: { object: "list", data: [
      { id: "disp_abc", payment_id: "pay_xyz", amount: 150, currency: "ZMW", status: "open", reason: "product_not_received", created_at: new Date(Date.now() - 86400000).toISOString() },
      { id: "disp_def", payment_id: "pay_uvw", amount: 500, currency: "ZMW", status: "won", reason: "duplicate", created_at: new Date(Date.now() - 604800000).toISOString() },
    ], has_more: false, total_count: 2 } }),
  "GET /v1/disputes/:id": (_b, params) => ({ status: 200, latency: 85,
    body: { id: params?.id || "disp_abc", object: "dispute", payment_id: "pay_xyz", amount: 150, currency: "ZMW", status: "open", reason: "product_not_received", evidence_due_by: new Date(Date.now() + 604800000).toISOString(), livemode: false } }),
  "POST /v1/disputes/:id/contest": (_b, params) => ({ status: 200, latency: 280,
    body: { id: params?.id || "disp_abc", object: "dispute", status: "under_review", evidence_submitted: true, submitted_at: new Date().toISOString(), livemode: false } }),
  "GET /v1/balance": () => ({ status: 200, latency: 55,
    body: { object: "balance", available: [{ amount: 125000.00, currency: "ZMW" }], pending: [{ amount: 8500.00, currency: "ZMW" }], reserved: [{ amount: 1200.00, currency: "ZMW" }], livemode: false } }),
  "POST /v1/reports/export": (body) => ({ status: 202, latency: 350,
    body: { id: "rpt_" + Math.random().toString(36).slice(2, 14), object: "report", format: body?.format || "csv", type: body?.type || "transactions", status: "processing", download_url: null, estimated_completion: new Date(Date.now() + 60000).toISOString(), livemode: false } }),
};

const methodColors: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  POST: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  PUT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  DELETE: "bg-red-500/15 text-red-400 border-red-500/30",
  PATCH: "bg-violet-500/15 text-violet-400 border-violet-500/30",
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

function generateCode(lang: CodeLang, method: string, url: string, apiKey: string, body?: string): string {
  let parsedBody: any = null;
  try { if (body) parsedBody = JSON.parse(body); } catch { /* skip */ }
  const hasBody = parsedBody && method !== "GET" && Object.keys(parsedBody).length > 0;
  const bodyJson = hasBody ? JSON.stringify(parsedBody, null, 2) : "";
  const bodyJsonOneline = hasBody ? JSON.stringify(parsedBody) : "";

  switch (lang) {
    case "curl": {
      let cmd = `curl -X ${method} "${url}" \\\n  -H "Authorization: Bearer ${apiKey}" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: $(uuidgen)"`;
      if (hasBody) cmd += ` \\\n  -d '${bodyJsonOneline}'`;
      return cmd;
    }
    case "javascript":
      return `const response = await fetch("${url}", {
  method: "${method}",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
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
      return `HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("${url}"))
    .header("Authorization", "Bearer ${apiKey}")
    .header("Content-Type", "application/json")
    .method("${method}", ${hasBody ? `HttpRequest.BodyPublishers.ofString("${bodyJsonOneline.replace(/"/g, '\\"')}")` : `HttpRequest.BodyPublishers.noBody()`})
    .build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`;
    case "go":
      return `package main

import ("fmt"; "io"; "net/http"${hasBody ? '; "strings"' : ""})

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
uri = URI.parse("${url}")
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true
request = Net::HTTP::${method === "GET" ? "Get" : method === "POST" ? "Post" : method === "PUT" ? "Put" : "Delete"}.new(uri.request_uri)
request["Authorization"] = "Bearer ${apiKey}"
request["Content-Type"] = "application/json"${hasBody ? `\nrequest.body = '${bodyJsonOneline}'` : ""}
response = http.request(request)
puts JSON.parse(response.body)`;
    case "csharp":
      return `var client = new HttpClient();
client.DefaultRequestHeaders.Add("Authorization", "Bearer ${apiKey}");
${hasBody
  ? `var content = new StringContent(@"${bodyJsonOneline.replace(/"/g, '""')}", Encoding.UTF8, "application/json");
var response = await client.${method === "POST" ? "PostAsync" : "PutAsync"}("${url}", content);`
  : `var response = await client.${method === "GET" ? "GetAsync" : "DeleteAsync"}("${url}");`}
var data = await response.Content.ReadAsStringAsync();
Console.WriteLine(data);`;
    default: return "";
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
  const [expandedCategory, setExpandedCategory] = useState<string | null>("Payments");
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

  const sendRequest = async () => {
    setLoading(true);
    setResponse(null);
    const lookupKey = `${selectedEndpoint.method} ${selectedEndpoint.path}`;
    const handler = MOCK_RESPONSES[lookupKey];
    await new Promise(r => setTimeout(r, 400 + Math.random() * 600));

    let body: any = null;
    try { body = JSON.parse(requestBody); } catch { /* skip */ }

    if (handler) {
      const result = handler(body, pathParamValues);
      setResponse(result);
      setHistory(prev => [{ endpoint: selectedEndpoint, response: result, timestamp: new Date() }, ...prev].slice(0, 20));
    } else {
      const fallback = { status: 200, latency: Math.floor(80 + Math.random() * 200), body: { message: "Mock response", endpoint: lookupKey } };
      setResponse(fallback);
      setHistory(prev => [{ endpoint: selectedEndpoint, response: fallback, timestamp: new Date() }, ...prev].slice(0, 20));
    }
    setLoading(false);
  };

  const copyResponse = () => {
    if (response) {
      navigator.clipboard.writeText(JSON.stringify(response.body, null, 2));
      setCopied(true);
      toast({ title: "Response copied" });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const url = `https://api.sandbox.bmaglasspay.com${resolvedPath}`;
  const codeSnippet = generateCode(codeLang, selectedEndpoint.method, url, apiKey, requestBody);

  const categories = Array.from(new Set(ENDPOINTS.map(e => e.category)));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      {/* Endpoint Sidebar */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Endpoints</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-y-auto">
            {categories.map((cat) => (
              <div key={cat}>
                <button
                  className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-muted/50"
                  onClick={() => setExpandedCategory(expandedCategory === cat ? null : cat)}
                >
                  {cat}
                  {expandedCategory === cat ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                {expandedCategory === cat && ENDPOINTS.filter(e => e.category === cat).map((ep) => {
                  const key = `${ep.method} ${ep.path}`;
                  const isActive = `${selectedEndpoint.method} ${selectedEndpoint.path}` === key;
                  return (
                    <button
                      key={key}
                      onClick={() => handleEndpointChange(key)}
                      className={`w-full flex items-center gap-2 px-4 py-2 text-left text-xs transition-colors ${isActive ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'}`}
                    >
                      <Badge className={`text-[9px] px-1.5 py-0 border ${methodColors[ep.method]}`}>{ep.method}</Badge>
                      <span className="truncate">{ep.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Main Panel */}
      <div className="space-y-4">
        {/* Request Bar */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <Badge className={`border font-mono text-xs ${methodColors[selectedEndpoint.method]}`}>
                {selectedEndpoint.method}
              </Badge>
              <code className="text-sm font-mono flex-1 text-foreground">{resolvedPath}</code>
              <Button onClick={sendRequest} disabled={loading} size="sm" className="h-8">
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                Send
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mb-3">{selectedEndpoint.description}</p>

            {/* API Key */}
            <div className="mb-3">
              <Label className="text-xs">API Key</Label>
              <Input value={apiKey} onChange={e => setApiKey(e.target.value)} className="h-8 font-mono text-xs mt-1" />
            </div>

            {/* Path Params */}
            {selectedEndpoint.pathParams?.map((param) => (
              <div key={param} className="mb-3">
                <Label className="text-xs">{param}</Label>
                <Input
                  value={pathParamValues[param] || ""}
                  onChange={e => setPathParamValues(prev => ({ ...prev, [param]: e.target.value }))}
                  placeholder={`Enter ${param}`}
                  className="h-8 font-mono text-xs mt-1"
                />
              </div>
            ))}

            {/* Body */}
            {selectedEndpoint.defaultBody && selectedEndpoint.method !== "GET" && (
              <div>
                <Label className="text-xs">Request Body</Label>
                <textarea
                  value={requestBody}
                  onChange={e => setRequestBody(e.target.value)}
                  className="w-full h-40 mt-1 font-mono text-xs p-3 rounded-lg bg-slate-900 text-slate-100 border border-slate-800 resize-y"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Code Generator */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <button onClick={() => setShowCodeGen(!showCodeGen)} className="flex items-center gap-2 text-sm font-medium">
              <Code2 className="h-4 w-4 text-primary" />
              Code Snippet
              {showCodeGen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          </CardHeader>
          {showCodeGen && (
            <CardContent className="pt-0">
              <div className="flex gap-1 mb-3 flex-wrap">
                {CODE_LANGS.map(l => (
                  <Button key={l.id} variant={codeLang === l.id ? "default" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setCodeLang(l.id)}>
                    {l.label}
                  </Button>
                ))}
              </div>
              <div className="relative group">
                <pre className="bg-slate-900 text-slate-100 border border-slate-800 rounded-lg p-4 overflow-x-auto text-xs font-mono max-h-60">
                  <code>{codeSnippet}</code>
                </pre>
                <Button
                  variant="ghost" size="sm"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-white hover:bg-slate-800"
                  onClick={() => {
                    navigator.clipboard.writeText(codeSnippet);
                    setCodeCopied(true);
                    toast({ title: "Code copied" });
                    setTimeout(() => setCodeCopied(false), 2000);
                  }}
                >
                  {codeCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Response */}
        {response && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant={response.status < 300 ? "default" : response.status < 500 ? "secondary" : "destructive"} className="font-mono text-xs">
                    {response.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {response.latency}ms
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={copyResponse} className="h-7">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="bg-slate-900 text-slate-100 border border-slate-800 rounded-lg p-4 overflow-x-auto text-xs font-mono max-h-80">
                <code>{JSON.stringify(response.body, null, 2)}</code>
              </pre>
            </CardContent>
          </Card>
        )}

        {/* History */}
        {history.length > 0 && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Request History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {history.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      handleEndpointChange(`${h.endpoint.method} ${h.endpoint.path}`);
                      setResponse(h.response);
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/50 transition-colors"
                  >
                    <Badge className={`text-[9px] px-1.5 py-0 border ${methodColors[h.endpoint.method]}`}>{h.endpoint.method}</Badge>
                    <span className="font-mono truncate flex-1 text-left">{h.endpoint.path}</span>
                    <Badge variant={h.response.status < 300 ? "default" : "destructive"} className="text-[9px]">{h.response.status}</Badge>
                    <span className="text-muted-foreground">{h.response.latency}ms</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
