import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import { TablePageSkeleton } from "@/components/ui/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileSearch,
  ShieldCheck,
} from "lucide-react";
import {
  EMPTY_FILTERS,
  FORENSIC_SOURCES,
  buildManifest,
  buildSearchArgs,
  countBySource,
  eventsToCsv,
  evidenceCounts,
  forensicErrorMessage,
  isUuid,
  searchScope,
  sha256Hex,
  withManifestHeader,
  type EvidencePack,
  type ExportFormat,
  type ExportManifest,
  type ForensicEvent,
  type ForensicFilters,
} from "@/lib/forensics";

// The forensic RPCs postdate the generated types; they go through
// the untyped rpc path other admin pages use (AdminSettings
// pattern). The functions themselves are the gate: every one of
// them refuses a caller who is not super_admin (42501).
const rpc = (
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown }> =>
  (
    supabase as unknown as {
      rpc: (
        name: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>;
    }
  ).rpc(fn, args);

const PAGE_SIZE = 50;
const EXPORT_CHUNK = 1000;
const EXPORT_CAP = 10000;

const sourceLabel = (source: string) =>
  source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

interface PendingExport {
  filename: string;
  mime: string;
  fileContent: string;
  manifest: ExportManifest;
}

const AdminForensics = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"search" | "timeline">("search");
  const [filters, setFilters] = useState<ForensicFilters>(EMPTY_FILTERS);
  const [events, setEvents] = useState<ForensicEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [timelineUser, setTimelineUser] = useState("");
  const [timeline, setTimeline] = useState<ForensicEvent[]>([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);

  const [pendingExport, setPendingExport] = useState<PendingExport | null>(
    null,
  );
  const [isExporting, setIsExporting] = useState(false);

  const runSearch = useCallback(
    async (nextPage: number) => {
      const built = buildSearchArgs(filters, PAGE_SIZE, nextPage * PAGE_SIZE);
      if ("problem" in built) {
        toast({
          title: "Check the filters",
          description: built.problem,
          variant: "destructive",
        });
        return;
      }
      setIsLoading(true);
      try {
        const { data, error } = await rpc("forensic_search", built.args);
        if (error) throw error;
        const rows = (data ?? []) as ForensicEvent[];
        setEvents(rows);
        setTotal(rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0);
        setPage(nextPage);
        setHasSearched(true);
        setExpanded(null);
      } catch (error) {
        toast({
          title: "Search failed",
          description: forensicErrorMessage(error),
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [filters, toast],
  );

  const loadTimeline = useCallback(
    async (userId: string) => {
      const target = userId.trim();
      if (!isUuid(target)) {
        toast({
          title: "Check the user ID",
          description: "The timeline needs a full user ID (UUID).",
          variant: "destructive",
        });
        return;
      }
      setIsTimelineLoading(true);
      try {
        const [timelineRes, packRes] = await Promise.all([
          rpc("forensic_user_timeline", {
            p_user_id: target,
            p_limit: 1000,
            p_offset: 0,
          }),
          rpc("forensic_user_evidence", { p_user_id: target }),
        ]);
        if (timelineRes.error) throw timelineRes.error;
        if (packRes.error) throw packRes.error;
        const rows = (timelineRes.data ?? []) as ForensicEvent[];
        setTimeline(rows);
        setTimelineTotal(rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0);
        setPack(packRes.data as EvidencePack);
        setExpanded(null);
      } catch (error) {
        toast({
          title: "Timeline failed",
          description: forensicErrorMessage(error),
          variant: "destructive",
        });
      } finally {
        setIsTimelineLoading(false);
      }
    },
    [toast],
  );

  // Jump target from /admin/users/:id ("Forensic timeline"): open
  // straight into that user's timeline.
  useEffect(() => {
    const user = searchParams.get("user");
    if (user && isUuid(user)) {
      setMode("timeline");
      setTimelineUser(user);
      void loadTimeline(user);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentUserId = useCallback(async (): Promise<string> => {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? "unknown";
  }, []);

  /** Fetch every row matching the current search filters (chunked,
   *  capped) for a full-result export. */
  const fetchAllSearchRows = useCallback(async (): Promise<ForensicEvent[]> => {
    const all: ForensicEvent[] = [];
    let offset = 0;
    for (;;) {
      const built = buildSearchArgs(filters, EXPORT_CHUNK, offset);
      if ("problem" in built) throw new Error(built.problem);
      const { data, error } = await rpc("forensic_search", built.args);
      if (error) throw error;
      const rows = (data ?? []) as ForensicEvent[];
      all.push(...rows);
      const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
      offset += rows.length;
      if (rows.length === 0 || offset >= totalCount || offset >= EXPORT_CAP) {
        break;
      }
    }
    return all.slice(0, EXPORT_CAP);
  }, [filters]);

  const prepareSearchExport = async (format: ExportFormat) => {
    setIsExporting(true);
    try {
      const rows = await fetchAllSearchRows();
      if (rows.length === 0) {
        toast({
          title: "Nothing to export",
          description: "The current filters match no events.",
        });
        return;
      }
      const generatedBy = await currentUserId();
      const counts = countBySource(rows);
      if (format === "csv") {
        const payload = eventsToCsv(rows);
        const checksum = await sha256Hex(payload);
        const manifest = buildManifest({
          kind: "search",
          format,
          generatedBy,
          scope: searchScope(filters),
          counts,
          totalRows: rows.length,
          checksum,
        });
        setPendingExport({
          filename: `forensic-search-${manifest.generated_at.replace(/[:.]/g, "-")}.csv`,
          mime: "text/csv",
          fileContent: withManifestHeader(payload, manifest),
          manifest,
        });
      } else {
        const payload = JSON.stringify(rows, null, 2);
        const checksum = await sha256Hex(payload);
        const manifest = buildManifest({
          kind: "search",
          format,
          generatedBy,
          scope: searchScope(filters),
          counts,
          totalRows: rows.length,
          checksum,
        });
        setPendingExport({
          filename: `forensic-search-${manifest.generated_at.replace(/[:.]/g, "-")}.json`,
          mime: "application/json",
          fileContent: JSON.stringify({ manifest, events: rows }, null, 2),
          manifest,
        });
      }
    } catch (error) {
      toast({
        title: "Export failed",
        description: forensicErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const preparePackExport = async (format: ExportFormat) => {
    if (!pack) return;
    setIsExporting(true);
    try {
      const generatedBy = await currentUserId();
      const counts = evidenceCounts(pack);
      const scope = { user_id: pack.user_id, email: pack.email };
      if (format === "csv") {
        const payload = eventsToCsv(pack.timeline);
        const checksum = await sha256Hex(payload);
        const manifest = buildManifest({
          kind: "evidence_pack",
          format,
          generatedBy,
          scope,
          counts,
          totalRows: pack.timeline.length,
          checksum,
        });
        setPendingExport({
          filename: `evidence-pack-${pack.user_id}.csv`,
          mime: "text/csv",
          fileContent: withManifestHeader(payload, manifest),
          manifest,
        });
      } else {
        const packBody = pack;
        const payload = JSON.stringify(packBody, null, 2);
        const checksum = await sha256Hex(payload);
        const manifest = buildManifest({
          kind: "evidence_pack",
          format,
          generatedBy,
          scope,
          counts,
          totalRows:
            counts.profile + counts.roles + counts.wallets +
            counts.transactions + counts.timeline,
          checksum,
        });
        setPendingExport({
          filename: `evidence-pack-${pack.user_id}.json`,
          mime: "application/json",
          fileContent: JSON.stringify({ manifest, pack: packBody }, null, 2),
          manifest,
        });
      }
    } catch (error) {
      toast({
        title: "Export failed",
        description: forensicErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  /** The manifest is written to the audit log FIRST; only a logged
   *  export is delivered. If the logging call fails, nothing
   *  downloads — an unlogged export vouches for nothing. */
  const confirmExport = async () => {
    if (!pendingExport) return;
    setIsExporting(true);
    try {
      const { error } = await rpc("forensic_log_export", {
        p_kind: pendingExport.manifest.kind,
        p_format: pendingExport.manifest.format,
        p_scope: pendingExport.manifest.scope,
        p_counts: pendingExport.manifest.counts,
        p_checksum: pendingExport.manifest.checksum_sha256,
        p_total_rows: pendingExport.manifest.total_rows,
      });
      if (error) throw error;
      const blob = new Blob([pendingExport.fileContent], {
        type: pendingExport.mime,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = pendingExport.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Export downloaded",
        description:
          "The export and its checksum are recorded in the audit log.",
      });
      setPendingExport(null);
    } catch (error) {
      toast({
        title: "Export not delivered",
        description:
          "The export could not be recorded in the audit log, so nothing was downloaded. " +
          forensicErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const renderEventRow = (event: ForensicEvent) => {
    const key = `${event.source}:${event.event_id}`;
    const isOpen = expanded === key;
    return (
      <div key={key} className="py-3 border-b last:border-0">
        <button
          type="button"
          className="w-full flex items-start justify-between gap-4 text-left"
          onClick={() => setExpanded(isOpen ? null : key)}
        >
          <div className="min-w-0">
            <p className="font-medium truncate">{event.summary}</p>
            <p className="text-sm text-muted-foreground">
              {formatWhen(event.occurred_at)} · {event.action}
              {event.actor_id ? ` · actor ${event.actor_id.slice(0, 8)}…` : " · system"}
              {event.target_user_id
                ? ` · user ${event.target_user_id.slice(0, 8)}…`
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline">{sourceLabel(event.source)}</Badge>
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>
        </button>
        {isOpen && (
          <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(
              {
                source: event.source,
                event_id: event.event_id,
                occurred_at: event.occurred_at,
                actor_id: event.actor_id,
                action: event.action,
                target_id: event.target_id,
                target_user_id: event.target_user_id,
                detail: event.detail,
              },
              null,
              2,
            )}
          </pre>
        )}
      </div>
    );
  };

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total],
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="flex items-center gap-3 mb-2">
          <FileSearch className="h-7 w-7" />
          <h1 className="text-2xl font-bold">Forensic Audit</h1>
          <Badge variant="secondary">Super admin</Badge>
        </div>
        <p className="text-sm text-muted-foreground mb-6 max-w-3xl">
          Every recorded event across the platform's audit trails —
          account actions, role changes, security events, identity,
          P2P, cards, AML and compliance — in one searchable record.
          Exports are checksummed and the export itself is written to
          the audit log before anything downloads.
        </p>

        <div className="flex gap-2 mb-6">
          <Button
            variant={mode === "search" ? "default" : "outline"}
            onClick={() => setMode("search")}
          >
            Event search
          </Button>
          <Button
            variant={mode === "timeline" ? "default" : "outline"}
            onClick={() => setMode("timeline")}
          >
            User timeline
          </Button>
        </div>

        {pendingExport && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" /> Export manifest
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
                <div>
                  <dt className="text-muted-foreground">File</dt>
                  <dd className="font-medium break-all">
                    {pendingExport.filename}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Rows</dt>
                  <dd className="font-medium">
                    {pendingExport.manifest.total_rows} (
                    {Object.entries(pendingExport.manifest.counts)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => `${sourceLabel(k)} ${n}`)
                      .join(", ") || "—"}
                    )
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">SHA-256 checksum</dt>
                  <dd className="font-mono text-xs break-all">
                    {pendingExport.manifest.checksum_sha256}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Scope</dt>
                  <dd className="font-mono text-xs break-all">
                    {JSON.stringify(pendingExport.manifest.scope)}
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground mb-4">
                Confirming writes this manifest to the audit log first,
                then the file downloads. Anyone can later recompute the
                checksum from the file and compare it with the audit
                record.
              </p>
              <div className="flex gap-2">
                <Button onClick={confirmExport} disabled={isExporting}>
                  <Download className="h-4 w-4 mr-2" />
                  Log &amp; download
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPendingExport(null)}
                  disabled={isExporting}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {mode === "search" && (
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Filters</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <label className="block">
                    <span className="text-sm font-medium">Actor user ID</span>
                    <Input
                      value={filters.actorId}
                      onChange={(e) =>
                        setFilters({ ...filters, actorId: e.target.value })
                      }
                      placeholder="UUID of who did it"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Target user ID</span>
                    <Input
                      value={filters.targetUserId}
                      onChange={(e) =>
                        setFilters({ ...filters, targetUserId: e.target.value })
                      }
                      placeholder="UUID of who it was about"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Source</span>
                    <select
                      className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={filters.source}
                      onChange={(e) =>
                        setFilters({ ...filters, source: e.target.value })
                      }
                    >
                      <option value="">All sources</option>
                      {FORENSIC_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {sourceLabel(source)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Action contains</span>
                    <Input
                      value={filters.action}
                      onChange={(e) =>
                        setFilters({ ...filters, action: e.target.value })
                      }
                      placeholder="e.g. frozen, role_change"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">From</span>
                    <Input
                      type="datetime-local"
                      value={filters.from}
                      onChange={(e) =>
                        setFilters({ ...filters, from: e.target.value })
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">To</span>
                    <Input
                      type="datetime-local"
                      value={filters.to}
                      onChange={(e) =>
                        setFilters({ ...filters, to: e.target.value })
                      }
                    />
                  </label>
                  <label className="block sm:col-span-2 lg:col-span-3">
                    <span className="text-sm font-medium">
                      Free text (searches the full event detail)
                    </span>
                    <Input
                      value={filters.text}
                      onChange={(e) =>
                        setFilters({ ...filters, text: e.target.value })
                      }
                      placeholder="e.g. an IP address, a reference, a reason"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button onClick={() => void runSearch(0)} disabled={isLoading}>
                    Search
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFilters(EMPTY_FILTERS);
                      setEvents([]);
                      setTotal(0);
                      setHasSearched(false);
                    }}
                  >
                    Clear
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    onClick={() => void prepareSearchExport("csv")}
                    disabled={isExporting || !hasSearched}
                  >
                    <Download className="h-4 w-4 mr-2" /> Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void prepareSearchExport("json")}
                    disabled={isExporting || !hasSearched}
                  >
                    <Download className="h-4 w-4 mr-2" /> Export JSON
                  </Button>
                </div>
              </CardContent>
            </Card>

            {isLoading ? (
              <TablePageSkeleton />
            ) : hasSearched ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {total.toLocaleString()} event{total === 1 ? "" : "s"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {events.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      No events match these filters.
                    </p>
                  ) : (
                    <>
                      {events.map(renderEventRow)}
                      <div className="flex items-center justify-between pt-4">
                        <Button
                          variant="outline"
                          disabled={page === 0 || isLoading}
                          onClick={() => void runSearch(page - 1)}
                        >
                          Previous
                        </Button>
                        <span className="text-sm text-muted-foreground">
                          Page {page + 1} of {pageCount}
                        </span>
                        <Button
                          variant="outline"
                          disabled={page + 1 >= pageCount || isLoading}
                          onClick={() => void runSearch(page + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">
                Set filters and run a search — or leave everything blank
                to browse the newest events across all sources.
              </p>
            )}
          </>
        )}

        {mode === "timeline" && (
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>User timeline &amp; evidence pack</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={timelineUser}
                    onChange={(e) => setTimelineUser(e.target.value)}
                    placeholder="Full user ID (UUID)"
                    className="flex-1"
                  />
                  <Button
                    onClick={() => void loadTimeline(timelineUser)}
                    disabled={isTimelineLoading}
                  >
                    Load timeline
                  </Button>
                </div>
                {pack && (
                  <div className="mt-4 text-sm">
                    <p className="font-medium">
                      {pack.email ?? "No email on record"}
                    </p>
                    <p className="text-muted-foreground">
                      Roles: {pack.roles.join(", ") || "none"} · Wallets:{" "}
                      {pack.wallets.length} · Transactions:{" "}
                      {pack.transactions.length} · Timeline events:{" "}
                      {timelineTotal}
                      {pack.profile?.is_frozen ? " · Account frozen" : ""}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Button
                        variant="outline"
                        onClick={() => void preparePackExport("json")}
                        disabled={isExporting}
                      >
                        <Download className="h-4 w-4 mr-2" /> Evidence pack
                        (JSON)
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void preparePackExport("csv")}
                        disabled={isExporting}
                      >
                        <Download className="h-4 w-4 mr-2" /> Timeline (CSV)
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {isTimelineLoading ? (
              <TablePageSkeleton />
            ) : timeline.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Timeline — {timelineTotal} event
                    {timelineTotal === 1 ? "" : "s"}, oldest first
                  </CardTitle>
                </CardHeader>
                <CardContent>{timeline.map(renderEventRow)}</CardContent>
              </Card>
            ) : pack ? (
              <p className="text-sm text-muted-foreground">
                No recorded events touch this user yet.
              </p>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
};

export default AdminForensics;
