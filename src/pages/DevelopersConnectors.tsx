import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Blocks,
  BookOpen,
  Code2,
  ExternalLink,
  Github,
  Key,
  Scale,
  Store,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  CONNECTORS_REPO_LICENSE_URL,
  CONNECTORS_REPO_README_URL,
  CONNECTORS_REPO_URL,
  CONNECTORS_REPO_VERSIONS_URL,
  SDK_GUIDE_URL,
  SDKS,
  STORE_CONNECTORS,
  type ConnectorEntry,
  type SdkEntry,
} from "@/lib/connectors";

// The connectors' home on the site (CEO directive, 2026-10-30): the
// artefacts themselves live in the public connectors repository —
// this page is the directory that points developers at the repo,
// per connector and per SDK. Data + verified facts live in
// src/lib/connectors.ts; every link there was checked against the
// live repo tree. Shopify is deliberately absent (assessment only).

function ConnectorCard({ entry }: { entry: ConnectorEntry }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">{entry.name}</CardTitle>
        <CardDescription>{entry.versions}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        <p className="flex-1">{entry.blurb}</p>
        <p className="text-muted-foreground">{entry.proof}.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={entry.readmeUrl} target="_blank" rel="noreferrer">
              <BookOpen className="h-4 w-4 mr-1" /> README &amp; setup
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={entry.folderUrl} target="_blank" rel="noreferrer">
              Source code <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SdkCard({ entry }: { entry: SdkEntry }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">{entry.name}</CardTitle>
        <CardDescription>
          <code>{entry.packageName}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm">
        <p className="flex-1">{entry.blurb}</p>
        <p>
          <Badge variant="outline">{entry.availability}</Badge>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={entry.readmeUrl} target="_blank" rel="noreferrer">
              <BookOpen className="h-4 w-4 mr-1" /> README &amp; setup
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={entry.folderUrl} target="_blank" rel="noreferrer">
              Source code <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DevelopersConnectors() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="bg-[#FEF3E2] dark:bg-background border-b border-[#CFD3D8]/70 dark:border-border">
        <div className="pt-10 pb-8 px-4 max-w-7xl mx-auto w-full">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Blocks className="h-7 w-7" /> Connectors &amp; SDKs
          </h1>
          <p className="text-muted-foreground max-w-3xl">
            Ready-made plugins, an embed button and typed SDKs for the BMaGlass Pay
            developer API. Everything listed here is finished, install-tested and
            open source — it all lives in one public repository, and this page is
            the directory to it.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <Button asChild>
              <a href={CONNECTORS_REPO_URL} target="_blank" rel="noreferrer">
                <Github className="h-4 w-4 mr-2" /> bmaglasspay-connectors on GitHub
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={CONNECTORS_REPO_LICENSE_URL} target="_blank" rel="noreferrer">
                <Scale className="h-4 w-4 mr-2" /> MIT licence
              </a>
            </Button>
            <span className="text-sm text-muted-foreground">
              Free to use, fork and ship — MIT licensed.
            </span>
          </div>
        </div>
      </div>

      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full space-y-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store className="h-5 w-5" /> How the shop connectors work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <strong>Your shop keeps its own catalogue and its own prices.</strong>{" "}
              Nothing is priced, synced or re-catalogued in BMaGlass Pay. At
              checkout, the connector creates a payment for the exact order total
              your shop computed and sends the buyer to the hosted BMaGlass Pay
              payment page.
            </p>
            <p>
              When the buyer pays, the signed <code>payment_link.paid</code> webhook
              completes the order in your shop — exactly once — and every connector
              also polls for reconciliation, so a missed webhook delivery never
              strands an order. Guests pay with Bitcoin from their own wallet on
              the hosted page; no BMaGlass account is needed to pay.
            </p>
            <p>
              <strong>Multivendor marketplaces work the same way:</strong> with
              Dokan, WCFM or a similar marketplace module, payments settle into the
              marketplace operator's BMaGlass Pay account, under the operator's API
              key. Settlement currencies are <strong>ZMW and USD</strong> — a
              connector refuses a store currency that has no matching BMaGlass
              wallet instead of inventing an exchange rate.
            </p>
            <p className="flex items-start gap-2">
              <Key className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Each connector talks to the merchant's own BMaGlass Pay account with
                an API key (<code>bmp_live_…</code> / <code>bmp_test_…</code>) issued
                from the dashboard — create one on the{" "}
                <Link className="underline" to="/api">
                  API page
                </Link>
                . Test keys are read-only by design: they can never move money.
              </span>
            </p>
          </CardContent>
        </Card>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Store className="h-6 w-6" /> Store connectors
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Plugins and modules under <code>integrations/</code> in the
              repository — per-version builds where the platform genuinely splits,
              one build where it does not. The full verified version matrix is in{" "}
              <a
                className="underline"
                href={CONNECTORS_REPO_VERSIONS_URL}
                target="_blank"
                rel="noreferrer"
              >
                VERSIONS.md
              </a>
              .
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {STORE_CONNECTORS.map((entry) => (
              <ConnectorCard key={entry.name} entry={entry} />
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Code2 className="h-6 w-6" /> SDKs
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Typed clients for the developer API under <code>sdk/</code> in the
              repository, all built against the same{" "}
              <a className="underline" href="/openapi.json" target="_blank" rel="noreferrer">
                OpenAPI contract
              </a>
              . Per-SDK install and test commands are in the{" "}
              <a className="underline" href={SDK_GUIDE_URL} target="_blank" rel="noreferrer">
                SDK guide
              </a>
              , and the in-app walkthrough is the{" "}
              <Link className="underline" to="/sdk-docs">
                SDK documentation
              </Link>
              .
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {SDKS.map((entry) => (
              <SdkCard key={entry.name} entry={entry} />
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Distribution, honestly: the SDKs are distributed from the connectors
            repository only — they are not yet published to npm, PyPI, Packagist or
            pub.dev, so install them from the repo (a git / path dependency), not
            from a package registry.
          </p>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Start from the repository</CardTitle>
            <CardDescription>
              The repository is the source of truth for every artefact above.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={CONNECTORS_REPO_URL} target="_blank" rel="noreferrer">
                <Github className="h-4 w-4 mr-2" /> Open the repository
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={CONNECTORS_REPO_README_URL} target="_blank" rel="noreferrer">
                <BookOpen className="h-4 w-4 mr-2" /> Repository README
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link to="/developers">Developer API documentation</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/sdk-docs">SDK documentation</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
