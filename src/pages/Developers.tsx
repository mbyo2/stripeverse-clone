import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Code2, Key, Shield, Webhook, AlertTriangle, Store } from "lucide-react";
import { Link } from "react-router-dom";
import ApiPlayground from "@/components/developers/ApiPlayground";

// Truth pass (2026-10-26): this page previously documented an API that
// did not exist. Everything below is the shipped developer-api surface —
// the same surface in /openapi.json and the SDKs.
const BASE = "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api";

const ENDPOINTS = [
  { method: "GET", path: "/wallets", scope: "wallets:read", desc: "List your wallets and balances" },
  { method: "GET", path: "/transactions", scope: "transactions:read", desc: "Recent transactions (limit 1–100)" },
  { method: "POST", path: "/transfers", scope: "transfers:write", desc: "Wallet-to-wallet transfer — live keys only, 1.5% fee charged on top, Idempotency-Key supported" },
  { method: "GET", path: "/payment-links", scope: "payment_links:read", desc: "List your payment links — each carries its fee_payer plus the computed fee_amount, buyer_total and seller_receives" },
  { method: "POST", path: "/payment-links", scope: "payment_links:write", desc: "Create a payment link — live keys only; optional fee_payer ('seller' | 'buyer') overrides your account default for this link" },
  { method: "GET", path: "/settings", scope: "any valid key", desc: "Your account's fee-bearer default (fee_payer_default) and the platform fee rate — set in your BMaGlass dashboard, read here" },
  { method: "GET", path: "/bitcoin/balance", scope: "bitcoin:read", desc: "Custodial Bitcoin balance (sats)" },
  { method: "GET", path: "/bitcoin/deposit-address", scope: "bitcoin:read", desc: "The custodial deposit address already issued to your account in the app" },
  { method: "POST", path: "/bitcoin/quote", scope: "bitcoin:read", desc: "60-second BTC buy/sell quote at the app's 1.5% fee — quote only, execution stays in the app" },
  { method: "GET", path: "/webhooks", scope: "any valid key", desc: "List your webhook endpoints (secrets are never returned)" },
  { method: "POST", path: "/webhooks", scope: "any valid key", desc: "Register an HTTPS webhook endpoint — signing secret shown once" },
  { method: "DELETE", path: "/webhooks/{id}", scope: "any valid key", desc: "Deactivate a webhook endpoint" },
  { method: "POST", path: "/webhooks/{id}/test", scope: "any valid key", desc: "Send a signed webhook.test event and log the delivery" },
  { method: "GET", path: "/webhook-deliveries", scope: "any valid key", desc: "Delivery log: status, HTTP response and error per attempt" },
];

const EVENTS = ["transaction.completed", "payment_link.created", "payment_link.paid", "webhook.test"];

export default function Developers() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="bg-[#FEF3E2] dark:bg-background border-b border-[#CFD3D8]/70 dark:border-border">
        <div className="pt-10 pb-8 px-4 max-w-7xl mx-auto w-full">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2"><Code2 className="h-7 w-7" /> Developers</h1>
          <p className="text-muted-foreground max-w-3xl">
            Build on BMaGlass Pay with the developer API: wallets, transfers, payment links and
            custodial Bitcoin, authenticated by API keys. This page documents only what is
            actually shipped — the machine-readable contract is the{" "}
            <a className="underline" href="/openapi.json" target="_blank" rel="noreferrer">OpenAPI spec</a>.
          </p>
        </div>
      </div>
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full space-y-8">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> Authentication &amp; modes</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Create a key on the <Link className="underline" to="/api">API page</Link> or in Business settings.
              Only its SHA-256 hash is stored; the full key is shown exactly once. Send it as:</p>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto">{`curl ${BASE}/wallets \\
  -H "X-Api-Key: bmp_test_your_key_here"`}</pre>
            <p><Badge variant="outline">bmp_test_</Badge> <strong>Test keys are read-only.</strong> This app has no
              test-mode ledger and no transaction is ever marked as test data, so a test key can never move
              real money — writes answer <code>403 test_mode_read_only</code>. Webhook registration and test
              delivery are allowed with test keys because they move no money.</p>
            <p><Badge>bmp_live_</Badge> Live keys move real money, scoped by the permissions chosen at
              creation (for example <code>transfers:write</code>). A key created without scopes is read-only.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Endpoints</CardTitle><CardDescription>Base URL: {BASE}</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {ENDPOINTS.map((e) => (
              <div key={e.method + e.path} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 p-3 border rounded">
                <span className="font-mono text-sm shrink-0">{e.method} {e.path}</span>
                <span className="text-sm text-muted-foreground flex-1">{e.desc}</span>
                <Badge variant="outline" className="shrink-0">{e.scope}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Webhook className="h-5 w-5" /> Webhooks</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Register an HTTPS endpoint and subscribe to the events that really occur:</p>
            <div className="flex flex-wrap gap-2">{EVENTS.map((ev) => <Badge key={ev} variant="secondary" className="font-mono">{ev}</Badge>)}</div>
            <p>Every delivery is signed with HMAC-SHA256 over the exact request body. Verify the
              <code> X-BMaGlass-Signature</code> header (<code>sha256=&lt;hex&gt;</code>) with your endpoint's
              secret — the SDKs ship a verification helper. Every attempt is written to the delivery log,
              visible on the API page and via <code>GET /webhook-deliveries</code>.</p>
            <p>When a buyer pays a <em>payment link</em>, <code>payment_link.paid</code> fires at settlement —
              exactly once per payment — carrying the link code, amount, currency, the settlement
              transaction id and the link's merchant-supplied reference/metadata, so a shop connector can
              complete the order immediately. Keep a polling fallback anyway: poll <code>GET /payment-links</code>
              (each link reports <code>payment_count</code> and <code>total_collected</code>) to reconcile any
              delivery your endpoint missed — that is the pattern the shop connectors below use
              (webhook first, reconciliation as the safety net).</p>
            <p><strong>Who pays the platform fee is the merchant's choice, made in BMaGlass Pay — not in
              your plugin.</strong> Every payment link carries a <code>fee_payer</code>: <code>seller</code> (the
              fee comes out of what the seller receives) or <code>buyer</code> (the fee is added on top, so the
              seller receives the full price). The default lives in the merchant's account settings
              (BMaGlass Pay → Settings → Payment); read it with <code>GET /settings</code> the moment you connect
              with their key, or pass <code>fee_payer</code> when creating a link to override it for that link.
              Plugins, extensions and SDKs have no fee-bearer setting of their own — they inherit the
              merchant's. Link responses include the computed <code>fee_amount</code>, <code>buyer_total</code> and
              <code>seller_receives</code>, and the <code>payment_link.paid</code> payload reports
              <code> fee_payer</code>, <code>fee_amount</code> and <code>total_charged</code> (what the buyer
              actually paid), so your shop can reconcile the paid total against the order total without
              reimplementing the fee math. Settlement always follows the link's stored value — it cannot
              be changed at pay time. Bitcoin payments honour the same stored choice in sats: with
              <code> buyer</code>, the quoted sats cover price + fee; with <code>seller</code>, the fee
              leaves the received sats.</p>
            <p><strong>Bitcoin QR checkout is built into the hosted pay page.</strong> Every payment
              link's page offers <em>Pay with Bitcoin</em> — a QR code and copyable address
              (on-chain, plus Lightning when available) that any guest can pay from their own
              Bitcoin wallet, with no BMaGlass account. Because every shop connector (WooCommerce,
              Odoo, PrestaShop, Magento, OpenCart), the embed button and the SDK checkouts redirect
              the buyer to that same hosted page, <strong>they all inherit Bitcoin QR checkout with
              zero connector code changes</strong>. Bitcoin settlements fire{' '}
              <code>payment_link.paid</code> with <code>payment_method</code>{' '}
              <code>bitcoin_onchain</code> or <code>bitcoin_lightning</code>, and a link's Bitcoin
              attempts (quote, sats received, status) are readable at{' '}
              <code>GET /payment-links/&#123;id&#125;/attempts</code>. To send buyers back to your
              store afterwards, set <code>redirect_url</code> when creating the link — the pay page
              then shows a <em>Return to store</em> action after a completed payment.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> SDKs</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Typed clients live in the public BMaGlass Pay connectors repository —
              <code>github.com/mbyo2/bmaglasspay-connectors</code> — under <code>sdk/</code> (they are not yet
              published to npm, PyPI, Packagist or pub.dev — install from that repo): TypeScript/JavaScript,
              Python, PHP and React Native:</p>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto">{`# TypeScript / JavaScript — sdk/typescript (@bmaglass/sdk)
import { BMaGlass } from "@bmaglass/sdk";
const client = new BMaGlass({ apiKey: "bmp_test_…" });
const wallets = await client.wallets.list();

# Python — sdk/python (bmaglass-sdk)
from bmaglass_sdk import BMaGlass
client = BMaGlass("bmp_test_…")
wallets = client.wallets.list()

# PHP — sdk/php (BMaGlass\\Sdk)
use BMaGlass\\Sdk\\Client;
$client = new Client(getenv("BMAGLASS_API_KEY"));
$wallets = $client->wallets();

# React Native / Expo — sdk/react-native (@bmaglass/sdk-react-native)
import { BMaGlass } from "@bmaglass/sdk-react-native";`}</pre>
            <Button asChild variant="outline"><Link to="/sdk-docs">SDK documentation</Link></Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Store className="h-5 w-5" /> Connectors &amp; integrations</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Ready-made integrations live in the same connectors repository
              (<code>github.com/mbyo2/bmaglasspay-connectors</code>) under <code>integrations/</code>. Each one
              talks to <strong>your own</strong> BMaGlass account and wallets through your API key; checkout
              creates a payment link and sends the buyer to the hosted payment page (buyers pay from their
              BMaGlass wallet — there is no guest checkout). All of them require a live key for checkout and
              a ZMW or USD store currency.</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>WooCommerce</strong> (WordPress 6.0+, WooCommerce 7.0 – 11.2) — <code>integrations/wordpress</code>: a payment gateway plugin covering HPOS and legacy order storage, and both the Checkout Blocks and classic checkout, with connection test, hosted-link checkout and automatic order completion.</li>
              <li><strong>Odoo 16, 17, 18, 19 and 20</strong> — <code>integrations/odoo</code>: a payment provider module per Odoo major (version folders <code>16.0/</code> – <code>20.0/</code>), each adapted to that version's payment framework.</li>
              <li><strong>Magento 2.4.6 – 2.4.9, PrestaShop 1.7 / 8 / 9, OpenCart 3 &amp; 4</strong> — <code>integrations/magento</code>, <code>integrations/prestashop</code>, <code>integrations/opencart</code>: gateway modules built on the PHP SDK, one build per platform version where the platform splits (see <code>VERSIONS.md</code> in the connectors repo for the full matrix).</li>
              <li><strong>Any website (Wix, Squarespace, Webflow, static)</strong> — <code>integrations/embed</code>: a small script that renders a Pay with BMaGlass Pay button bound to a payment link you create here. Only the public link goes in the page — never an API key.</li>
              <li><strong>Zapier / Make</strong> — <code>integrations/automation</code>: recipes using their native webhook/HTTP modules (no app-store listing exists or is claimed).</li>
              <li><strong>Shopify</strong> — checkout payments are gated by Shopify's payments partner programme, so there is no BMaGlass checkout plugin. Payment links and the embed button work in Shopify pages and emails today; see <code>integrations/shopify/ASSESSMENT.md</code>.</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-amber-500/40">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Not available via the API</CardTitle></CardHeader>
          <CardContent className="text-sm">
            MoonPay, Stripe, the Payoneer partner API and virtual-card issuing to third parties are not
            live for API use. They are documented here as unavailable rather than stubbed as working —
            there are no endpoints for them and calls to invented routes return 404.
          </CardContent>
        </Card>

        <ApiPlayground />
      </main>
      <Footer />
    </div>
  );
}
