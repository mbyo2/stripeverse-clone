import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import { CONNECTORS_REPO_URL } from "@/lib/connectors";

// Downloads section for /developers — renders from public/downloads.json,
// the one manifest the ZIP assembly step regenerates (see
// scripts/upload-zips.sh). One entry per downloadable integration; the
// buttons are plain <a href> links to the versioned ZIPs in the public
// Supabase Storage bucket `downloads`.
//
// Manifest schema (one object per download):
//   { name, platform, version, file, url, size?, sha256? }
//   - name: display name, e.g. "WooCommerce"
//   - platform: slug, e.g. "woocommerce" — the file is always
//     `bmaglasspay-<platform>-<version>.zip`
//   - version: the package version, e.g. "1.0.0"
//   - file: the object name in the bucket
//   - url: the full public storage URL for the file
//   - size: bytes on disk — filled in by scripts/upload-zips.sh when the
//     real ZIP is uploaded; absent until then
//   - sha256: hex digest of the uploaded ZIP — filled in by
//     scripts/upload-zips.sh; absent until then. Never ship a placeholder
//     hash: if it is absent, no hash is shown.
//
// Honesty rules (do not weaken):
//   - Shopify has NO download button: there is no Shopify checkout
//     plugin (payments partner programme gate) — assessment only.
//   - No pricing discussion in this section.
//   - If the manifest cannot be loaded, show that plainly and link the
//     connectors repository — never render invented buttons.
//   - If a single package file is missing/unreachable, the button must
//     not be a dead link: the click first verifies the file answers,
//     and on failure shows a clear per-file error with a way forward
//     (retry, or the connectors repository) instead of navigating the
//     user to a storage error page.

export interface DownloadEntry {
  name: string;
  platform: string;
  version: string;
  file: string;
  url: string;
  size?: number;
  sha256?: string;
}

const MANIFEST_URL = "/downloads.json";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DownloadsSection() {
  const [entries, setEntries] = useState<DownloadEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Platforms whose file did not answer the pre-download check —
  // the button stays, but the user gets a clear error, not a dead
  // link to a storage error page.
  const [unreachable, setUnreachable] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});

  // Verify the file answers before downloading it: a manifest entry
  // can outlive its object (re-upload, rename, bucket mishap), and a
  // plain link would land the user on a bare storage error page.
  // A HEAD that fails (404, network, or a CORS-blocked error page)
  // shows the per-file error instead; a HEAD that answers starts
  // the same download the link would have. One retry rides out the
  // storage endpoint's occasional dropped connection (seen live)
  // so a transient drop does not cry wolf on a healthy file.
  function handleDownload(e: React.MouseEvent<HTMLAnchorElement>, entry: DownloadEntry) {
    e.preventDefault();
    if (checking[entry.platform]) return;
    setChecking((prev) => ({ ...prev, [entry.platform]: true }));
    const head = (): Promise<Response> =>
      fetch(entry.url, { method: "HEAD" }).catch(() =>
        new Promise<Response>((resolve) => setTimeout(() => resolve(fetch(entry.url, { method: "HEAD" })), 300)),
      );
    head()
      .then((res) => {
        if (!res.ok) throw new Error(`download file answered ${res.status}`);
        const a = document.createElement("a");
        a.href = entry.url;
        a.download = entry.file;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setUnreachable((prev) => ({ ...prev, [entry.platform]: false }));
      })
      .catch(() => {
        setUnreachable((prev) => ({ ...prev, [entry.platform]: true }));
      })
      .finally(() => {
        setChecking((prev) => ({ ...prev, [entry.platform]: false }));
      });
  }

  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`downloads manifest answered ${res.status}`);
        return res.json() as Promise<DownloadEntry[]>;
      })
      .then((data) => {
        if (!cancelled) setEntries(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" /> Downloads
        </CardTitle>
        <CardDescription>
          Ready-made packages for each integration — download the package for your platform,
          upload it to your store, and connect it with your API key. Each package is the same
          code as in the connectors repository.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {failed && (
          <p>
            The download list could not be loaded. The packages are still available from the
            connectors repository:{" "}
            <a className="underline" href={CONNECTORS_REPO_URL} target="_blank" rel="noreferrer">
              {CONNECTORS_REPO_URL}
            </a>
            .
          </p>
        )}
        {!failed && entries === null && <p className="text-muted-foreground">Loading downloads…</p>}
        {!failed && entries !== null && entries.length === 0 && (
          <p>No packages are listed yet — see the connectors repository for the source.</p>
        )}
        {!failed &&
          entries !== null &&
          entries.map((entry) => (
            <div
              key={entry.platform}
              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 border rounded"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{entry.name}</strong>
                  <Badge variant="outline">v{entry.version}</Badge>
                  {typeof entry.size === "number" && (
                    <span className="text-muted-foreground">{formatSize(entry.size)}</span>
                  )}
                </div>
                {entry.sha256 && (
                  <p className="text-muted-foreground break-all mt-1">
                    SHA-256: <code>{entry.sha256}</code>
                  </p>
                )}
                {unreachable[entry.platform] && (
                  <p role="alert" className="mt-1">
                    This package could not be reached — the file may have been removed. Try
                    again, or get the same code from the connectors repository:{" "}
                    <a className="underline" href={CONNECTORS_REPO_URL} target="_blank" rel="noreferrer">
                      {CONNECTORS_REPO_URL}
                    </a>
                    .
                  </p>
                )}
              </div>
              <Button asChild className="shrink-0">
                <a href={entry.url} download={entry.file} onClick={(e) => handleDownload(e, entry)}>
                  {checking[entry.platform] ? `Checking ${entry.name}…` : `Download ${entry.name} — v${entry.version}`}
                </a>
              </Button>
            </div>
          ))}
        <p className="text-muted-foreground">
          Shopify has no downloadable package: checkout payments are gated by Shopify&apos;s
          payments partner programme, so there is no BMaGlass checkout plugin. Payment links
          and the embed button work in Shopify pages and emails today — see{" "}
          <a
            className="underline"
            href={`${CONNECTORS_REPO_URL}/blob/main/integrations/shopify/ASSESSMENT.md`}
            target="_blank"
            rel="noreferrer"
          >
            integrations/shopify/ASSESSMENT.md
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
