import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code2 } from "lucide-react";

// Truth pass (2026-10-26): documents only the SDKs that actually
// ship in this repository under sdk/.
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

export default function SdkDocs() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-5xl mx-auto w-full space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2"><Code2 className="h-7 w-7" /> SDK Documentation</h1>
          <p className="text-muted-foreground">
            Two SDKs ship in this project's repository under <code>sdk/</code>. They are not yet published
            to npm or PyPI — install them from the repository. Both cover every endpoint of the shipped
            developer-api, use API-key auth, raise typed errors, and include a webhook signature
            verification helper. Contract tests for both live in <code>sdk/tests/</code>.
          </p>
        </div>

        <Tabs defaultValue="ts">
          <TabsList>
            <TabsTrigger value="ts">TypeScript / JavaScript</TabsTrigger>
            <TabsTrigger value="py">Python</TabsTrigger>
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
        </Tabs>

        <Card>
          <CardHeader><CardTitle>Honest limits</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>There is no PHP SDK. There are no charges, invoices, customers, subscriptions or card-issuing
              methods — those APIs do not exist. Test keys are read-only in both SDKs, exactly as on the API:
              write calls with a test key surface the API's <code>403 test_mode_read_only</code> error.</p>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
