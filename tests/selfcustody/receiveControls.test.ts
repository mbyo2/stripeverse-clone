// Workstream A pins (CEO report, 2026-10-25): in the self-custody
// wallet, the receive controls for the three destination kinds —
// Lightning invoice, Spark address, Bitcoin address — "isn't
// showing like it's clickable or not attracting to be clicked".
// The action was a thin full-width OUTLINE button labelled "Show
// address" / "Create invoice". These tests pin the replacement:
// one solid Bitcoin-orange pill (the same treatment as the card's
// "Buy Bitcoin" button), a per-kind icon + verb label, a segmented
// pill selector with real press state, and everything inert while
// a Spark operation is in flight.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const page = read("../../src/pages/SelfCustodyWallet.tsx");

const receiveBlock = page.slice(
  page.indexOf('aria-label="Receive type"') - 200,
  page.indexOf('aria-label="Receive type"') + 6000,
);

describe("receive kind selector — one segmented pill group for all three kinds", () => {
  it("renders all three kinds with icons and pressed state", () => {
    for (const label of ["Lightning invoice", "Bitcoin address", "Spark address"]) {
      expect(receiveBlock).toContain(label);
    }
    expect(receiveBlock).toContain('aria-pressed={receiveKind === "bolt11"}');
    expect(receiveBlock).toContain('aria-pressed={receiveKind === "bitcoin"}');
    expect(receiveBlock).toContain('aria-pressed={receiveKind === "spark"}');
    expect(receiveBlock).toContain("rounded-full bg-muted p-1");
  });

  it("the whole selector is inert while a Spark operation is in flight", () => {
    const buttons = receiveBlock.match(/disabled=\{spBusy\}/g) ?? [];
    expect(buttons.length).toBe(3);
  });
});

describe("receive action — unmistakably tappable", () => {
  it("uses the solid Bitcoin-orange pill treatment, not the old outline button", () => {
    expect(receiveBlock).toContain("bg-[#F7931A] text-black font-semibold");
    expect(receiveBlock).toContain("h-11 w-full rounded-full");
    // The old non-affordance labels are gone.
    expect(page).not.toContain('"Create invoice" : "Show address"');
    expect(page).not.toContain('? "Create invoice" : "Show address"');
  });

  it("labels the action per kind with a verb and an icon", () => {
    expect(receiveBlock).toContain("Create Lightning invoice");
    expect(receiveBlock).toContain("Show Bitcoin address");
    expect(receiveBlock).toContain("Show Spark address");
  });

  it("shows a busy state (spinner + progress label) instead of a live-looking control while loading", () => {
    expect(receiveBlock).toContain('aria-busy={spBusy}');
    expect(receiveBlock).toContain("Creating invoice…");
    expect(receiveBlock).toContain("Loading address…");
    expect(receiveBlock).toContain("animate-spin");
  });

  it("stays disabled without an unlocked session", () => {
    expect(receiveBlock).toContain("disabled={spBusy || !session.mnemonic}");
  });
});
