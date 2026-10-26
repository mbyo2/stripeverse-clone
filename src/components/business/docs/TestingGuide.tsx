import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Truth pass (2026-10-26): there is no fake sandbox with test cards or
// test phone numbers — this guide now describes how testing honestly
// works against this API.
export function TestingGuide() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Testing Guide</CardTitle>
        <CardDescription>How to test against the BMaGlass Pay developer API — honestly.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <strong>Use a test key for reads.</strong> Create a <code>bmp_test_</code> key on the API page.
          Every read endpoint works with it and returns your real account data (wallets, transactions,
          payment links, Bitcoin balance).
        </p>
        <p>
          <strong>Writes with a test key are refused, by design.</strong> This app has no test-mode ledger
          and no transaction is ever marked as test data, so a test key can never move real money:
          transfers and payment-link creation answer <code>403 test_mode_read_only</code>. There are no
          test card numbers, test phone numbers or simulated balances.
        </p>
        <p>
          <strong>Webhooks can be tested safely.</strong> Register an endpoint with a test key, then
          <code> POST /webhooks/{"{id}"}/test</code> sends a real signed <code>webhook.test</code> event and
          records the attempt in the delivery log — verify your signature handling against it.
        </p>
        <p>
          <strong>Quotes are safe to test.</strong> <code>POST /bitcoin/quote</code> creates a 60-second
          price quote and moves no money; execution only happens in the app.
        </p>
        <p>
          <strong>When you must test a live write,</strong> use a live key on your own account with the
          smallest amount and an <code>Idempotency-Key</code> header, and check the delivery log and
          transaction list afterwards. Live writes move real money.
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
