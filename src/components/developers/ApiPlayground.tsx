import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Loader2 } from "lucide-react";

// The playground makes REAL calls to the shipped developer-api with a key
// you paste in. The response below is exactly what the
// API returned. Use a test key (bmp_test_…) — reads work, writes are
// refused with test_mode_read_only, by design.
const BASE = "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api";

const ROUTES = [
  { id: "wallets", label: "GET /wallets", method: "GET", path: "wallets" },
  { id: "transactions", label: "GET /transactions?limit=10", method: "GET", path: "transactions?limit=10" },
  { id: "payment-links", label: "GET /payment-links", method: "GET", path: "payment-links" },
  { id: "bitcoin-balance", label: "GET /bitcoin/balance", method: "GET", path: "bitcoin/balance" },
  { id: "bitcoin-address", label: "GET /bitcoin/deposit-address", method: "GET", path: "bitcoin/deposit-address" },
  { id: "webhooks", label: "GET /webhooks", method: "GET", path: "webhooks" },
  { id: "deliveries", label: "GET /webhook-deliveries", method: "GET", path: "webhook-deliveries" },
  { id: "quote", label: "POST /bitcoin/quote (buy K100)", method: "POST", path: "bitcoin/quote", body: { side: "buy", amount_zmw: 100 } },
  { id: "transfer", label: "POST /transfers (live keys only)", method: "POST", path: "transfers", body: { to_user_id: "00000000-0000-0000-0000-000000000000", amount: 1 } },
] as const;

export default function ApiPlayground() {
  const [apiKey, setApiKey] = useState("");
  const [routeId, setRouteId] = useState<string>("wallets");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ status: number; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const route = ROUTES.find((r) => r.id === routeId) ?? ROUTES[0];
    setRunning(true); setResult(null); setError(null);
    try {
      const res = await fetch(`${BASE}/${route.path}`, {
        method: route.method,
        headers: { "X-Api-Key": apiKey.trim(), "Content-Type": "application/json" },
        body: route.method === "POST" ? JSON.stringify((route as any).body ?? {}) : undefined,
      });
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setResult({ status: res.status, body: pretty });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Play className="h-5 w-5" /> API Playground</CardTitle>
        <CardDescription>
          Live calls to the real developer-api — no simulated responses. Paste an API key
          (create one on the API page). Test keys are read-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="pg-key">API key</Label>
          <Input id="pg-key" type="password" placeholder="bmp_test_… or bmp_live_…" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} className="mt-1 font-mono" autoComplete="off" />
          <p className="text-xs text-muted-foreground mt-1">The key is sent only to the developer-api function, from your browser. It is never stored.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-56">
            <Label>Endpoint</Label>
            <Select value={routeId} onValueChange={setRouteId}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROUTES.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={running || !apiKey.trim()}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            <span className="ml-1">Send request</span>
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result && (
          <div>
            <p className="text-sm mb-1">HTTP {result.status}</p>
            <pre className="bg-muted p-4 rounded-lg text-xs overflow-x-auto max-h-96 overflow-y-auto">{result.body}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
