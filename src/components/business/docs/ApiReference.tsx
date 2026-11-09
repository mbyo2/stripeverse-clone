import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Truth pass (2026-10-26): only the shipped developer-api surface.
// Environments (2026-11-09): production keys (bmg_live_, legacy
// bmp_live_) move real money; sandbox keys (bmg_sandbox_, legacy
// bmp_test_) run on mainnet formats with simulated money.
const BASE = "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api";
const ENDPOINTS = [
  { method: "GET", path: "/connector/config", scope: "config:read", desc: "Everything a plugin or SDK renders from: environment, business country/currency, feature states (incl. mobile money), settlement type" },
  { method: "GET", path: "/wallets", scope: "wallets:read", desc: "List wallets and balances" },
  { method: "GET", path: "/transactions", scope: "transactions:read", desc: "Recent transactions" },
  { method: "POST", path: "/transfers", scope: "transfers:write", desc: "Wallet-to-wallet transfer (production keys only)" },
  { method: "GET", path: "/payment-links", scope: "payment_links:read", desc: "List payment links in the key's environment" },
  { method: "POST", path: "/payment-links", scope: "payment_links:write", desc: "Create a payment link (a sandbox key creates a sandbox link)" },
  { method: "POST", path: "/payment-links/{id}/simulate-payment", scope: "payment_links:write", desc: "Simulate a payment on a sandbox link (sandbox keys only)" },
  { method: "POST", path: "/invoices", scope: "invoices:create", desc: "Create an invoice in the key's environment" },
  { method: "GET", path: "/invoices", scope: "invoices:read", desc: "List invoices in the key's environment" },
  { method: "POST", path: "/invoices/{id}/simulate-payment", scope: "invoices:create", desc: "Simulate payment of a sandbox invoice (sandbox keys only)" },
  { method: "GET", path: "/bitcoin/balance", scope: "bitcoin:read", desc: "Custodial Bitcoin balance" },
  { method: "GET", path: "/bitcoin/deposit-address", scope: "bitcoin:read", desc: "Issued custodial deposit address" },
  { method: "POST", path: "/bitcoin/quote", scope: "bitcoin:read", desc: "60-second BTC quote (execution stays in the app)" },
  { method: "GET|POST", path: "/webhooks", scope: "any valid key", desc: "List / register webhook endpoints for the key's environment (secret shown once)" },
  { method: "GET", path: "/webhook-deliveries", scope: "any valid key", desc: "Webhook delivery log" },
];

export function ApiReference() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>API Reference</CardTitle>
        <CardDescription>
          Base URL {BASE} · Auth: <code>X-Api-Key: bmg_live_… / bmg_sandbox_…</code> (legacy bmp_ keys
          keep working) · Sandbox keys simulate payments — see the Testing Guide · Full contract: <a className="underline" href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {ENDPOINTS.map((e) => (
          <div key={e.method + e.path} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 p-3 border rounded">
            <span className="font-mono text-sm shrink-0">{e.method} {e.path}</span>
            <span className="text-sm text-muted-foreground flex-1">{e.desc}</span>
            <Badge variant="outline">{e.scope}</Badge>
          </div>
        ))}
        <p className="text-sm text-muted-foreground pt-2">
          Not available via the API: MoonPay and third-party card issuing.
        </p>
      </CardContent>
    </Card>
  );
}
