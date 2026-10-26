import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code2 } from "lucide-react";

// Truth pass (2026-10-26): documents only the SDKs that actually
// ship — in the public bmaglasspay-connectors repository, under sdk/.
const TS_EXAMPLE = `import { BMaGlass, BMaGlassError, verifyWebhookSignature } from "@bmaglass/sdk";

const client = new BMaGlass({ apiKey: "bmp_test_…" }); // test keys are read-only

const wallets = await client.wallets.list();
const txns = await client.transactions.list(10);
const btc = await client.bitcoin.balance();
const quote = await client.bitcoin.quote({ side: "buy", amount_zmw: 100 });

// Live keys only — a test key throws BMaGlassError with code "test_mode_read_only":
try {
  await client.transfers.create(
    { to_user_id: "recipient-user-id", amount: 100, currency: "ZMW" },
    "my-idempotency-key",
  );
} catch (e) {
  if (e instanceof BMaGlassError) console.error(e.status, e.code, e.message);
}

// Webhook verification (in your webhook handler, using the RAW body):
const ok = verifyWebhookSignature(rawBody, req.headers["x-bmglass-signature"], webhookSecret);`;

const PY_EXAMPLE = `from bmaglass_sdk import BMaGlass, BMaGlassError, verify_webhook_signature

client = BMaGlass("bmp_test_...")  # test keys are read-only

wallets = client.wallets.list()
txns = client.transactions.list(10)
btc = client.bitcoin.balance()
quote = client.bitcoin.quote("buy", amount_zmw=100)

# Live keys only — a test key raises BMaGlassError with code "test_mode_read_only":
try:
    client.transfers.create(to_user_id="recipient-user-id", amount=100,
                            idempotency_key="my-idempotency-key")
except BMaGlassError as e:
    print(e.status, e.code, e.message)

# Webhook verification (raw request body bytes):
ok = verify_webhook_signature(request.data,
                              request.headers["X-BMaGlass-Signature"],
                              webhook_secret)`;

const PHP_EXAMPLE = `use BMaGlass\\Sdk\\Client;
use BMaGlass\\Sdk\\ApiException;

$client = new Client(getenv("BMAGLASS_API_KEY")); // test keys are read-only

$wallets = $client->wallets();
$btc = $client->bitcoinBalance();
$quote = $client->bitcoinQuote("buy", 100);

// Live keys only — a test key throws ApiException with code "test_mode_read_only":
try {
    $link = $client->createPaymentLink("Order #7", 250.00, "ZMW");
    $url = Client::paymentLinkUrl($link["link_code"]); // hosted page for the buyer
    $client->createTransfer($toUserId, 100, "ZMW", null, null, "my-idempotency-key");
} catch (ApiException $e) {
    echo $e->userMessage(); // plain language, safe to show
}

// Webhook verification (exact raw body + X-BMaGlass-Signature header):
$ok = Client::verifyWebhookSignature($rawBody, $signatureHeader, $webhookSecret);`;

const RN_EXAMPLE = `import { BMaGlass, BMaGlassError, paymentLinkUrl, verifyWebhookSignature } from "@bmaglass/sdk-react-native";

const client = new BMaGlass({ apiKey: "bmp_test_…" }); // test keys are read-only

const wallets = await client.wallets.list();
const btc = await client.bitcoin.balance();

// Live keys only — a test key throws BMaGlassError with code "test_mode_read_only".
// Webhook verification uses a bundled pure-TS HMAC-SHA256 (no WebCrypto needed):
try {
  const link = await client.paymentLinks.create({ title: "Order #7", amount: 250, currency: "ZMW" });
  const url = paymentLinkUrl(link.link_code); // open for the buyer
} catch (e) {
  if (e instanceof BMaGlassError) showMessage(e.userMessage());
}`;

export default function SdkDocs() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-5xl mx-auto w-full space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2"><Code2 className="h-7 w-7" /> SDK Documentation</h1>
          <p className="text-muted-foreground">
            Four SDKs ship in the public BMaGlass Pay connectors repository
            (<code>github.com/mbyo2/bmaglasspay-connectors</code>) under <code>sdk/</code>: TypeScript, Python, PHP
            and React Native. They are not yet published to npm, PyPI or Packagist — install them from that
            repository. Each covers every endpoint of the shipped developer-api, uses API-key auth, raises
            typed errors, and includes a webhook signature verification helper. Contract tests for each
            live beside it (the shared HMAC known-answer vector is identical across all of them).
          </p>
        </div>

        <Tabs defaultValue="ts">
          <TabsList>
            <TabsTrigger value="ts">TypeScript / JavaScript</TabsTrigger>
            <TabsTrigger value="py">Python</TabsTrigger>
            <TabsTrigger value="php">PHP</TabsTrigger>
            <TabsTrigger value="rn">React Native</TabsTrigger>
          </TabsList>
          <TabsContent value="ts">
            <Card>
              <CardHeader>
                <CardTitle>@bmaglass/sdk <Badge variant="outline">v1.0.0 · sdk/typescript</Badge></CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">{`cd sdk/typescript && npm install && npm run build
# then depend on it from your app, e.g. "dependencies": { "@bmaglass/sdk": "file:../sdk/typescript" }`}</pre>
                <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">{TS_EXAMPLE}</pre>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="py">
            <Card>
              <CardHeader>
                <CardTitle>bmaglass-sdk <Badge variant="outline">v1.0.0 · sdk/python</Badge></CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">{`pip install ./sdk/python   # installs the bmaglass_sdk package (depends on requests)`}</pre>
                <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">{PY_EXAMPLE}</pre>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="php">
            <Card>
              <CardHeader>
                <CardTitle>bmaglass/bmaglass-sdk <Badge variant="outline">v1.0.0 · sdk/php</Badge></CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">{`# Framework-free (PHP 7.4+, cURL). Add the connectors repo (github.com/mbyo2/bmaglasspay-connectors) as a Composer path/vcs repository,
# or copy src/ and register the BMaGlass\\Sdk\\ PSR-4 prefix.
php sdk/php/tests/run-tests.php   # the test suite`}</pre>
                <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">{PHP_EXAMPLE}</pre>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="rn">
            <Card>
              <CardHeader>
                <CardTitle>@bmaglass/sdk-react-native <Badge variant="outline">v1.0.0 · sdk/react-native</Badge></CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">{`# React Native / Expo. Add from the repo, e.g.
# "dependencies": { "@bmaglass/sdk-react-native": "file:../sdk/react-native" }`}</pre>
                <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">{RN_EXAMPLE}</pre>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader><CardTitle>Honest limits</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>There are no charges, invoices, customers, subscriptions or card-issuing
              methods — those APIs do not exist. Test keys are read-only in every SDK, exactly as on the API:
              write calls with a test key surface the API's <code>403 test_mode_read_only</code> error.</p>
            <p>Shop integrations (WooCommerce 7.0 – 11.2, Odoo 16 – 20, Magento 2.4.6 – 2.4.9, PrestaShop 1.7 / 8 / 9, OpenCart 3 &amp; 4), a universal pay-button
              embed and Zapier/Make recipes live under <code>integrations/</code> in the connectors repository
              (<code>github.com/mbyo2/bmaglasspay-connectors</code>) — see the
              Developers page. Shopify checkout is gated by Shopify's payments partner programme, so no
              checkout plugin exists; payment links work there today.</p>
            <p>Webhooks: when a payment link is paid, the <code>payment_link.paid</code> event fires at
              settlement (exactly once per payment) — verify it with the same signature helper shown in
              each SDK tab above, and keep polling <code>GET /payment-links</code> as a reconciliation
              fallback for any delivery your endpoint missed. The payload's data also reports the fee
              truth — <code>fee_payer</code> (<code>seller</code> | <code>buyer</code>), <code>fee_amount</code> and
              <code> total_charged</code> — who bore the payment-link platform fee and what the buyer
              actually paid in total. Who pays the fee is the merchant's account setting in BMaGlass
              Pay (readable via <code>GET /settings</code>); SDKs and plugins inherit it and have no
              fee-bearer setting of their own.</p>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
