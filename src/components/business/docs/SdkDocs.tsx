import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Truth pass (2026-10-26; completed 2026-10-28): the SDKs that actually
// ship in sdk/ of the public connectors repo — all five of them.
export function SdkDocs() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>SDKs</CardTitle>
        <CardDescription>
          In-repo SDKs for the developer-api — not yet published to npm, PyPI, Packagist or pub.dev. Contract tests: sdk/tests/.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="font-medium">TypeScript / JavaScript <Badge variant="outline">@bmaglass/sdk v1.0.0 · sdk/typescript</Badge></p>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto mt-2">{`import { BMaGlass } from "@bmaglass/sdk";
const client = new BMaGlass({ apiKey: "bmp_test_…" });
const wallets = await client.wallets.list();
const quote = await client.bitcoin.quote({ side: "buy", amount_zmw: 100 });`}</pre>
        </div>
        <div>
          <p className="font-medium">Python <Badge variant="outline">bmaglass-sdk v1.0.0 · sdk/python</Badge></p>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto mt-2">{`from bmaglass_sdk import BMaGlass
client = BMaGlass("bmp_test_...")
wallets = client.wallets.list()`}</pre>
        </div>
        <div>
          <p className="font-medium">PHP <Badge variant="outline">bmaglass/bmaglass-sdk v1.0.0 · sdk/php</Badge></p>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto mt-2">{`use BMaGlass\\Sdk\\Client;
$client = new Client(getenv("BMAGLASS_API_KEY"));
$wallets = $client->wallets();`}</pre>
        </div>
        <div>
          <p className="font-medium">React Native / Expo <Badge variant="outline">@bmaglass/sdk-react-native v1.0.0 · sdk/react-native</Badge></p>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto mt-2">{`import { BMaGlass } from "@bmaglass/sdk-react-native";
const client = new BMaGlass({ apiKey: "bmp_test_…" });
const wallets = await client.wallets.list();`}</pre>
        </div>
        <div>
          <p className="font-medium">Flutter (Dart) <Badge variant="outline">bmaglass_sdk v1.0.0 · sdk/flutter</Badge></p>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto mt-2">{`import 'package:bmaglass_sdk/bmaglass_sdk.dart';
final client = BMaGlass(apiKey: 'bmp_test_…');
final wallets = await client.wallets();`}</pre>
        </div>
        <p className="text-muted-foreground">
          All five SDKs: typed clients for every shipped endpoint (including GET /settings and
          payment-link Bitcoin attempts), typed errors (with status + code, e.g. test_mode_read_only),
          and a webhook signature verification helper.
        </p>
      </CardContent>
    </Card>
  );
}
