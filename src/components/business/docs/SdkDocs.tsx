import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Truth pass (2026-10-26): the SDKs that actually ship in sdk/.
export function SdkDocs() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>SDKs</CardTitle>
        <CardDescription>
          In-repo SDKs for the developer-api — not yet published to npm/PyPI. Contract tests: sdk/tests/.
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
        <p className="text-muted-foreground">
          Both SDKs: typed clients for every shipped endpoint, typed errors (BMaGlassError with status +
          code, e.g. test_mode_read_only), and a webhook signature verification helper. There is no PHP SDK.
        </p>
      </CardContent>
    </Card>
  );
}
