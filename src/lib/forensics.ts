// Pure logic for the superadmin Forensic Audit console
// (/admin/forensics): the normalized event model that mirrors
// public.forensic_search / forensic_user_timeline (migration
// 20261277), the export builders (CSV / JSON), the export manifest
// and its SHA-256 integrity checksum.
//
// The server is the authority: the three forensic RPCs and the
// export-logging RPC are SECURITY DEFINER and refuse anyone who is
// not super_admin (42501), whatever this module does. This module
// only shapes what the page sends, renders and downloads.
//
// Export integrity model: the payload bytes are generated here, the
// manifest (kind, format, scope, per-source counts, total rows,
// checksum) is computed over those exact bytes and written to
// audit_logs via forensic_log_export BEFORE the download fires.
// Anyone holding the file later can recompute the checksum and
// compare it with the audit row: an export nobody logged vouches
// for nothing.
//
// Kept dependency-light and pure so the rules are unit-testable
// without a browser or a database (the platformSettings pattern).

import { toUserFacingError } from "@/utils/userFacingError";

/** The nine event sources in the forensic union (migration 20261277).
 *  webhook_delivery_logs / developer_event_dispatches are delivery
 *  telemetry, not actor events, and are deliberately absent. */
export const FORENSIC_SOURCES = [
  "audit_logs",
  "role_audit",
  "security_events",
  "identity_audit_log",
  "p2p_audit_log",
  "p2p_risk_events",
  "card_access_audit",
  "aml_screenings",
  "compliance_checks",
] as const;

export type ForensicSource = (typeof FORENSIC_SOURCES)[number];

/** One normalized forensic event — the shape every RPC returns. */
export interface ForensicEvent {
  source: string;
  event_id: string;
  occurred_at: string;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  target_user_id: string | null;
  summary: string;
  detail: Record<string, unknown>;
  total_count?: number;
}

/** The search filter model the console edits. Empty string = unset. */
export interface ForensicFilters {
  actorId: string;
  action: string;
  targetUserId: string;
  source: string;
  from: string;
  to: string;
  text: string;
}

export const EMPTY_FILTERS: ForensicFilters = {
  actorId: "",
  action: "",
  targetUserId: "",
  source: "",
  from: "",
  to: "",
  text: "",
};

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const isUuid = (value: string): boolean => UUID_RE.test(value.trim());

/** Build the forensic_search RPC arguments from the filter model.
 *  Returns a plain-language problem string instead when a field the
 *  server would reject is malformed (ids must be full UUIDs). */
export function buildSearchArgs(
  filters: ForensicFilters,
  limit: number,
  offset: number,
): { args: Record<string, unknown> } | { problem: string } {
  const actor = filters.actorId.trim();
  const target = filters.targetUserId.trim();
  if (actor && !isUuid(actor)) {
    return { problem: "The actor filter needs a full user ID (UUID)." };
  }
  if (target && !isUuid(target)) {
    return { problem: "The target filter needs a full user ID (UUID)." };
  }
  if (
    filters.source &&
    !(FORENSIC_SOURCES as readonly string[]).includes(filters.source)
  ) {
    return { problem: "That event source is not part of the forensic record." };
  }
  return {
    args: {
      p_actor: actor || null,
      p_action: filters.action.trim() || null,
      p_target_user: target || null,
      p_source: filters.source || null,
      p_from: filters.from ? new Date(filters.from).toISOString() : null,
      p_to: filters.to ? new Date(filters.to).toISOString() : null,
      p_text: filters.text.trim() || null,
      p_limit: limit,
      p_offset: offset,
    },
  };
}

/** The scope object recorded in the export manifest for a search:
 *  exactly the filters that produced the exported rows. */
export function searchScope(filters: ForensicFilters): Record<string, unknown> {
  return {
    actor_id: filters.actorId.trim() || null,
    action: filters.action.trim() || null,
    target_user_id: filters.targetUserId.trim() || null,
    source: filters.source || null,
    from: filters.from || null,
    to: filters.to || null,
    text: filters.text.trim() || null,
  };
}

/** Per-source row counts for a set of events (the manifest's counts
 *  for a search export). Every known source appears, zero-filled, so
 *  a manifest always accounts for the whole union. */
export function countBySource(
  events: readonly ForensicEvent[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const source of FORENSIC_SOURCES) counts[source] = 0;
  for (const event of events) {
    counts[event.source] = (counts[event.source] ?? 0) + 1;
  }
  return counts;
}

export type ExportKind = "search" | "evidence_pack";
export type ExportFormat = "csv" | "json";

export interface ExportManifest {
  kind: ExportKind;
  format: ExportFormat;
  generated_at: string;
  generated_by: string;
  scope: Record<string, unknown>;
  counts: Record<string, number>;
  total_rows: number;
  checksum_sha256: string;
}

export function buildManifest(input: {
  kind: ExportKind;
  format: ExportFormat;
  generatedBy: string;
  scope: Record<string, unknown>;
  counts: Record<string, number>;
  totalRows: number;
  checksum: string;
  generatedAt?: Date;
}): ExportManifest {
  return {
    kind: input.kind,
    format: input.format,
    generated_at: (input.generatedAt ?? new Date()).toISOString(),
    generated_by: input.generatedBy,
    scope: input.scope,
    counts: input.counts,
    total_rows: input.totalRows,
    checksum_sha256: input.checksum,
  };
}

/** SHA-256 (hex) of a string's UTF-8 bytes — WebCrypto, available in
 *  browsers and in the test runtime. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const CSV_COLUMNS = [
  "source",
  "event_id",
  "occurred_at",
  "actor_id",
  "action",
  "target_id",
  "target_user_id",
  "summary",
  "detail",
] as const;

const csvCell = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** The payload rows of an events CSV (header + one row per event,
 *  detail as compact JSON). The manifest header lines are added by
 *  withManifestHeader so the CHECKSUM covers exactly these bytes. */
export function eventsToCsv(events: readonly ForensicEvent[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const event of events) {
    lines.push(
      [
        event.source,
        event.event_id,
        event.occurred_at,
        event.actor_id ?? "",
        event.action,
        event.target_id ?? "",
        event.target_user_id ?? "",
        event.summary,
        JSON.stringify(event.detail ?? {}),
      ]
        .map((cell) => csvCell(String(cell)))
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

/** Prefix a CSV payload with its manifest as `#` comment lines, so
 *  the downloaded file is self-verifying: strip the `#` lines,
 *  recompute SHA-256 over the rest, compare with the manifest (and
 *  with the audit_logs row forensic_log_export wrote). */
export function withManifestHeader(
  payload: string,
  manifest: ExportManifest,
): string {
  const header = [
    `# BMaGlass Pay forensic export`,
    `# kind: ${manifest.kind}`,
    `# format: ${manifest.format}`,
    `# generated_at: ${manifest.generated_at}`,
    `# generated_by: ${manifest.generated_by}`,
    `# scope: ${JSON.stringify(manifest.scope)}`,
    `# counts: ${JSON.stringify(manifest.counts)}`,
    `# total_rows: ${manifest.total_rows}`,
    `# checksum_sha256: ${manifest.checksum_sha256}`,
  ].join("\n");
  return `${header}\n${payload}`;
}

/** The evidence pack as returned by forensic_user_evidence. */
export interface EvidencePack {
  user_id: string;
  email: string | null;
  account_created_at: string | null;
  profile: Record<string, unknown> | null;
  roles: string[];
  wallets: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  timeline: ForensicEvent[];
  generated_at: string;
}

/** Per-section counts for an evidence pack manifest. total_rows for
 *  a pack counts the timeline rows in a CSV export and every section
 *  row in a JSON export — the counts object always says which. */
export function evidenceCounts(pack: EvidencePack): Record<string, number> {
  return {
    profile: pack.profile ? 1 : 0,
    roles: pack.roles.length,
    wallets: pack.wallets.length,
    transactions: pack.transactions.length,
    timeline: pack.timeline.length,
  };
}

/** Plain-language surfacing for forensic RPC failures. The gate's
 *  refusal (42501) gets its own sentence; nothing raw reaches the
 *  page. */
export function forensicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/42501|super admin/i.test(raw)) {
    return "Forensic audit tools are available to super admins only.";
  }
  if (/Unknown forensic source/i.test(raw)) {
    return "That event source is not part of the forensic record.";
  }
  if (/user id is required/i.test(raw)) {
    return "Enter a user ID first.";
  }
  return toUserFacingError(
    error,
    "Something went wrong with the forensic tools. Please try again.",
  );
}
