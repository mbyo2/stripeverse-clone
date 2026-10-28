// Coordinator consolidation pins (pre-launch sweep, 2026-10-28):
//  - Part 3 relabels handed over by the connectors/docs track:
//    FAQ must not claim Visa/Mastercard/USSD/bank transfers are
//    supported; the footer must not list Visa/Mastercard as if
//    live; virtual-card fee rows must carry their limited-release
//    status; the FAQ KYC answer must state the live-camera rule.
//  - Developer API: an idempotent transfer REPLAY returns the
//    original transaction_id and moves no money, so it must not
//    re-dispatch transaction.completed. The handler claims the
//    announcement in developer_event_dispatches (migration
//    20261244, the payment_link.paid pattern) before dispatching —
//    the event fires exactly once, when the money actually moved.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

describe("part 3 relabels (faq / footer / pricing / billing)", () => {
  it("FAQ no longer claims card/USSD/bank rails are supported", () => {
    const faq = read("../../src/pages/Faq.tsx");
    expect(faq).not.toContain("are also supported");
    expect(faq).toContain("aren't live yet");
  });
  it("FAQ KYC answer states the live-camera face rule", () => {
    const faq = read("../../src/pages/Faq.tsx");
    expect(faq).toContain("capture your face live with your camera");
    expect(faq).not.toContain("a selfie, and proof of address");
  });
  it("Footer lists only live rails unqualified", () => {
    const footer = read("../../src/components/Footer.tsx");
    expect(footer).not.toContain("'Visa'");
    expect(footer).not.toContain("'Mastercard'");
    expect(footer).toContain("'Cards — coming soon'");
    expect(footer).toContain("'PayPal'");
  });
  it("virtual-card fee rows carry the limited-release note", () => {
    expect(read("../../src/pages/Pricing.tsx")).toContain("limited release");
    expect(read("../../src/pages/Billing.tsx")).toContain("Fund a virtual card (limited release)");
  });
});

describe("developer-api transfer webhook fires exactly once", () => {
  it("dispatch is claimed in developer_event_dispatches before dispatching", () => {
    const api = read("../../supabase/functions/developer-api/index.ts");
    expect(api).toContain("developer_event_dispatches");
    expect(api).toContain("`transaction.completed:${txId}`");
    const claim = api.indexOf("developer_event_dispatches");
    const gate = api.indexOf("if (claimed)", claim);
    const dispatch = api.indexOf("dispatchEvent", gate);
    expect(claim).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(claim);
    expect(dispatch).toBeGreaterThan(gate);
  });
  it("migration 20261244 creates the claim table, service-role only", () => {
    const mig = read("../../supabase/migrations/20261244_developer_event_dispatches.sql");
    expect(mig).toContain("developer_event_dispatches");
    expect(mig).toContain("ENABLE ROW LEVEL SECURITY");
    expect(mig).toContain("REVOKE ALL ON public.developer_event_dispatches FROM anon, authenticated");
  });
});
