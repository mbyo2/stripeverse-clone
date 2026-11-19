// Unit tests for the forensic audit console (src/lib/forensics.ts +
// the wiring around it): the super_admin-only visibility rule, the
// search-argument shaping that mirrors forensic_search (migration
// 20261277), the export builders, and the manifest/checksum
// integrity flow.
//
// The database is the authority — the forensic RPCs refuse anyone
// who is not super_admin (42501) whatever the UI does. These tests
// pin that the UI never shows the surface to anyone else and that
// an export's checksum genuinely recomputes over its payload.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { adminDashboardVisibility } from "../../src/lib/roleVisibility";
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
  type ForensicEvent,
} from "../../src/lib/forensics";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(here, rel), "utf8");

const SUPER = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";

const ev = (over: Partial<ForensicEvent> = {}): ForensicEvent => ({
  source: "audit_logs",
  event_id: "evt-1",
  occurred_at: "2026-11-19T20:00:00.000Z",
  actor_id: SUPER,
  action: "account_frozen",
  target_id: TARGET,
  target_user_id: TARGET,
  summary: "account_frozen on profiles",
  detail: { reason: "QA seed" },
  ...over,
});

// ---------------------------------------------------------------------
// Visibility: the Forensic Audit card exists ONLY for super_admin.
// ---------------------------------------------------------------------

describe("forensics visibility — super_admin only, by absence", () => {
  it("renders the card for a super_admin holder", () => {
    expect(adminDashboardVisibility(["user", "super_admin"]).forensics).toBe(
      true,
    );
    expect(adminDashboardVisibility(["super_admin"]).forensics).toBe(true);
  });

  it("never renders it for a plain admin, plain user, or no roles", () => {
    expect(adminDashboardVisibility(["admin"]).forensics).toBe(false);
    expect(adminDashboardVisibility(["user"]).forensics).toBe(false);
    expect(adminDashboardVisibility(["p2p_admin"]).forensics).toBe(false);
    expect(adminDashboardVisibility([]).forensics).toBe(false);
  });

  it("the route is gated to super_admin alone", () => {
    const routes = read("../../src/components/AnimatedRoutes.tsx");
    expect(routes).toContain(
      `path="/admin/forensics" element={<RoleGuardedPage roles={['super_admin']}>`,
    );
  });

  it("the dashboard card names its own forensics gate", () => {
    const dashboard = read("../../src/pages/AdminDashboard.tsx");
    expect(dashboard).toContain('gate: "forensics"');
    expect(dashboard).toContain('"/admin/forensics"');
  });

  it("the user-detail jump link renders only for a super_admin viewer", () => {
    const detail = read("../../src/pages/AdminUserDetail.tsx");
    expect(detail).toContain("viewerIsSuperAdmin &&");
    expect(detail).toContain("/admin/forensics?user=${userId}");
  });
});

// ---------------------------------------------------------------------
// Search argument shaping
// ---------------------------------------------------------------------

describe("buildSearchArgs", () => {
  it("maps empty filters to nulls (unfiltered browse)", () => {
    const built = buildSearchArgs(EMPTY_FILTERS, 50, 0);
    expect(built).toEqual({
      args: {
        p_actor: null,
        p_action: null,
        p_target_user: null,
        p_source: null,
        p_from: null,
        p_to: null,
        p_text: null,
        p_limit: 50,
        p_offset: 0,
      },
    });
  });

  it("passes valid UUIDs and trims text filters", () => {
    const built = buildSearchArgs(
      {
        ...EMPTY_FILTERS,
        actorId: ` ${SUPER} `,
        targetUserId: TARGET,
        action: " frozen ",
        source: "role_audit",
        text: " 10.0.0.1 ",
      },
      25,
      50,
    );
    expect("args" in built && built.args).toMatchObject({
      p_actor: SUPER,
      p_target_user: TARGET,
      p_action: "frozen",
      p_source: "role_audit",
      p_text: "10.0.0.1",
      p_limit: 25,
      p_offset: 50,
    });
  });

  it("refuses malformed ids and unknown sources in plain language", () => {
    const badActor = buildSearchArgs(
      { ...EMPTY_FILTERS, actorId: "not-a-uuid" },
      50,
      0,
    );
    expect("problem" in badActor && badActor.problem).toMatch(/full user ID/);
    const badSource = buildSearchArgs(
      { ...EMPTY_FILTERS, source: "webhook_delivery_logs" },
      50,
      0,
    );
    expect("problem" in badSource && badSource.problem).toMatch(
      /not part of the forensic record/,
    );
  });

  it("isUuid accepts only full UUIDs", () => {
    expect(isUuid(SUPER)).toBe(true);
    expect(isUuid("11111111-1111-4111-8111")).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("the union is exactly the nine actor-event sources", () => {
    expect(FORENSIC_SOURCES).toHaveLength(9);
    expect(FORENSIC_SOURCES).not.toContain("webhook_delivery_logs");
  });
});

// ---------------------------------------------------------------------
// Counts + scope
// ---------------------------------------------------------------------

describe("countBySource / searchScope", () => {
  it("zero-fills every source and counts what is present", () => {
    const counts = countBySource([
      ev(),
      ev({ source: "role_audit", event_id: "evt-2" }),
      ev({ source: "role_audit", event_id: "evt-3" }),
    ]);
    expect(counts.audit_logs).toBe(1);
    expect(counts.role_audit).toBe(2);
    expect(counts.security_events).toBe(0);
    expect(Object.keys(counts)).toHaveLength(9);
  });

  it("scope records exactly the filters that produced the export", () => {
    expect(
      searchScope({ ...EMPTY_FILTERS, action: " frozen ", source: "audit_logs" }),
    ).toEqual({
      actor_id: null,
      action: "frozen",
      target_user_id: null,
      source: "audit_logs",
      from: null,
      to: null,
      text: null,
    });
  });
});

// ---------------------------------------------------------------------
// CSV building + manifest + checksum integrity
// ---------------------------------------------------------------------

describe("events CSV + manifest integrity", () => {
  const events = [
    ev(),
    ev({
      source: "role_audit",
      event_id: "evt-2",
      action: "role_change",
      summary: 'Role user → admin, "quoted" and, comma',
      detail: { old_role: "user", new_role: "admin" },
    }),
  ];

  it("builds a header + one row per event, escaping quotes and commas", () => {
    const csv = eventsToCsv(events);
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "source,event_id,occurred_at,actor_id,action,target_id,target_user_id,summary,detail",
    );
    expect(lines[2]).toContain('"Role user → admin, ""quoted"" and, comma"');
    expect(lines[1]).toContain('"{""reason"":""QA seed""}"');
  });

  it("sha256Hex matches node:crypto over the same bytes", async () => {
    const payload = eventsToCsv(events);
    const expected = createHash("sha256").update(payload, "utf8").digest("hex");
    await expect(sha256Hex(payload)).resolves.toBe(expected);
  });

  it("the manifest header makes the CSV self-verifying", async () => {
    const payload = eventsToCsv(events);
    const checksum = await sha256Hex(payload);
    const manifest = buildManifest({
      kind: "search",
      format: "csv",
      generatedBy: SUPER,
      scope: searchScope(EMPTY_FILTERS),
      counts: countBySource(events),
      totalRows: events.length,
      checksum,
      generatedAt: new Date("2026-11-20T00:00:00.000Z"),
    });
    const file = withManifestHeader(payload, manifest);
    // Verification flow: strip the `#` lines, recompute, compare.
    const stripped = file
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .join("\n");
    expect(stripped).toBe(payload);
    await expect(sha256Hex(stripped)).resolves.toBe(manifest.checksum_sha256);
    expect(file).toContain(`# checksum_sha256: ${checksum}`);
    expect(manifest.total_rows).toBe(2);
    expect(manifest.counts.role_audit).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Evidence pack counts
// ---------------------------------------------------------------------

describe("evidenceCounts", () => {
  it("counts every pack section", () => {
    const pack: EvidencePack = {
      user_id: TARGET,
      email: "qa@example.test",
      account_created_at: "2026-11-20T00:00:00.000Z",
      profile: { id: TARGET },
      roles: ["user"],
      wallets: [{ id: "w1" }, { id: "w2" }],
      transactions: [{ id: "t1" }],
      timeline: [ev(), ev({ event_id: "evt-9" })],
      generated_at: "2026-11-20T00:00:00.000Z",
    };
    expect(evidenceCounts(pack)).toEqual({
      profile: 1,
      roles: 1,
      wallets: 2,
      transactions: 1,
      timeline: 2,
    });
  });
});

// ---------------------------------------------------------------------
// Error surfacing
// ---------------------------------------------------------------------

describe("forensicErrorMessage", () => {
  it("gives the gate refusal its own plain sentence", () => {
    expect(
      forensicErrorMessage(
        new Error("Only a super admin can use the forensic audit tools"),
      ),
    ).toBe("Forensic audit tools are available to super admins only.");
  });

  it("never surfaces a raw database string", () => {
    const message = forensicErrorMessage(
      new Error("42501: permission denied for function forensic_search"),
    );
    expect(message).toBe(
      "Forensic audit tools are available to super admins only.",
    );
  });
});
