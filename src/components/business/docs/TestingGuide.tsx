import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Environments guide (2026-11-09): the API ships in two environments.
// Sandbox keys run the full API on mainnet formats with simulated
// money — objects are segregated per environment and sandbox payments
// settle only through the simulation endpoints. Nothing here invents
// test cards or test phone numbers; the sandbox is the API itself,
// with simulated settlement.
export function TestingGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Testing Guide</CardTitle>
        <CardDescription>How the sandbox environment works — and how to test against it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <strong>Use a sandbox key to build.</strong> Create a <code>bmg_sandbox_</code> key on the API
          page (older <code>bmp_test_</code> keys are sandbox keys too). A sandbox key puts every SDK and
          plugin into sandbox mode automatically — the environment comes from the key, never from a
          setting. Reads return your real account data (wallets, transactions, Bitcoin balance).
        </p>
        <p>
          <strong>Sandbox writes are simulated, not refused.</strong> With a sandbox key you can create
          invoices and payment links end-to-end. They live in the sandbox environment only: production
          keys never see them, the hosted checkout refuses sandbox links, and no real wallet, ledger or
          chain is ever touched. Real-money transfers are the one exception — a sandbox key attempting
          one answers <code>403 test_mode_read_only</code>.
        </p>
        <p>
          <strong>Drive a sandbox payment to paid.</strong> Call
          <code> POST /invoices/{"{id}"}/simulate-payment</code> or
          <code> POST /payment-links/{"{id}"}/simulate-payment</code> with the same sandbox key. The
          object settles and the normal webhook flow fires to your sandbox webhook endpoints, with
          <code> simulated: true</code> in the payload — so your full integration, webhooks included,
          runs before you ever take a real payment. Production keys are refused at these endpoints
          (<code>403 simulation_not_available</code>).
        </p>
        <p>
          <strong>Webhooks are per environment.</strong> Endpoints registered with a sandbox key only
          receive sandbox events; <code>POST /webhooks/{"{id}"}/test</code> sends a signed
          <code> webhook.test</code> event so you can verify signature handling.
        </p>
        <p>
          <strong>Check what your key unlocks.</strong> <code>GET /connector/config</code> answers with
          the key alone and returns your environment, business country and currency, feature states
          (including mobile money, which is available to businesses registered in Zambia) and your
          settlement type — exactly what the plugins and SDKs render from.
        </p>
        <p>
          <strong>Go live by swapping the key.</strong> Use a production key (<code>bmg_live_</code>, or
          an older <code>bmp_live_</code> key) on your own account with the smallest amount and an
          <code> Idempotency-Key</code> header, and check the delivery log and transaction list
          afterwards. Production writes move real money.
        </p>
        <p>
          <strong>Run the SDK contract tests</strong> before integrating: <code>sdk/tests/</code> in the
          public connectors repository (<code>github.com/mbyo2/bmaglasspay-connectors</code>) covers
          the SDKs (request shapes, typed errors, and a known-answer webhook signature vector).
        </p>
      </CardContent>
    </Card>
  );
}
