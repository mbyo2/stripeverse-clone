// Menu-scroll pins (CEO report, 2026-11-20): "The drop down menu or
// things in the menu are hiding below and the things on it can't
// scroll upwards on desktop. So I can't click them."
//
// Evidence base: a local rendered probe (headless Chromium against
// the live site, superadmin QA account) measured every header menu
// at 1440x900 / 1366x768 / 1280x720 / 1280x640. Root cause: the
// shared Radix content primitives carried `overflow-hidden` with NO
// max-height, so a menu taller than the viewport spilled past the
// bottom edge — and because a modal Radix menu locks page scroll,
// the spilled items were unreachable and unclickable:
//   - Header "Business" menu: 21 items, 682px tall. At 1280x720 its
//     last item ("Connectors & SDKs") ended at y=735 (past the 720
//     edge); at 1280x640 it was not clickable at its centre, and
//     wheel + scrollTop attempts never brought it into view.
//   - Header account menu (superadmin): 595px tall. At 1280x640 its
//     last item ("Sign Out") ended at y=648 — outside the viewport.
// Fix: every popper content primitive caps its height at the space
// Radix itself measured (--radix-*-content-available-height) and
// scrolls internally (overflow-y-auto). These pins keep that
// contract from regressing in any menu surface, not just the two
// the CEO hit.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("dropdown menus: viewport-capped and internally scrollable", () => {
  const src = read("src/components/ui/dropdown-menu.tsx");

  it("content caps at the Radix available height and scrolls in Y", () => {
    expect(src).toContain(
      "max-h-[var(--radix-dropdown-menu-content-available-height)]"
    );
    expect(src).toContain("overflow-y-auto");
    expect(src).toContain("overflow-x-hidden");
  });

  it("no dropdown content variant keeps the old uncapped overflow-hidden", () => {
    expect(src).not.toContain("min-w-[8rem] overflow-hidden");
  });
});

describe("popovers: same cap, same internal scroll", () => {
  const src = read("src/components/ui/popover.tsx");

  it("popover content caps at the Radix available height and scrolls in Y", () => {
    expect(src).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(src).toContain("overflow-y-auto");
  });
});

describe("selects: design cap kept, but never past the measured space", () => {
  const src = read("src/components/ui/select.tsx");

  it("select content caps at min(24rem, available height)", () => {
    expect(src).toContain(
      "max-h-[min(24rem,var(--radix-select-content-available-height))]"
    );
    expect(src).not.toContain("relative z-50 max-h-96");
  });
});

describe("context menus and menubars carry the same contract", () => {
  it("context menu content caps and scrolls", () => {
    const src = read("src/components/ui/context-menu.tsx");
    expect(src).toContain(
      "max-h-[var(--radix-context-menu-content-available-height)]"
    );
    expect(src).toContain("overflow-y-auto");
    expect(src).not.toContain("min-w-[8rem] overflow-hidden");
  });

  it("menubar content caps and scrolls", () => {
    const src = read("src/components/ui/menubar.tsx");
    expect(src).toContain("max-h-[var(--radix-menubar-content-available-height)]");
    expect(src).toContain("overflow-y-auto");
    expect(src).not.toContain("overflow-hidden rounded-md");
  });
});

describe("the tall header menus ride the fixed primitive", () => {
  const header = read("src/components/Header.tsx");

  it("Header builds its menus from the shared DropdownMenuContent", () => {
    expect(header).toContain('from "@/components/ui/dropdown-menu"');
    // The two menus the probe proved overflow at desktop heights:
    // Business (21 items, ends in Connectors & SDKs) and the account
    // menu (ends in Sign Out) both render through DropdownMenuContent.
    expect(header).toContain("Connectors &amp; SDKs");
    expect(header).toContain("Sign Out");
    const contents = header.match(/<DropdownMenuContent/g) ?? [];
    expect(contents.length).toBeGreaterThanOrEqual(4);
  });
});

// Dialog/drawer pins (CEO report, 2026-11-24): "things that need
// selection like roles — the list of the drop down is going beyond
// the screen and there is nothing the user can do."
//
// The popper primitives above were already capped, but the centred
// Dialog / AlertDialog contents and the bottom Drawer content still
// carried NO max-height and NO scroll: a panel taller than a phone
// screen rendered past both screen edges (rendered probe at
// 390x560: a long form dialog measured 1,362px tall, spanning
// y=-372..990, scrollTop immovable) while the modal locked page
// scroll — title, fields and buttons unreachable. Every dialog
// whose caller did not hand-add its own max-h was exposed (34 bare
// <DialogContent> usages). The cap now lives in the primitives.
describe("dialogs and drawers: viewport-capped and internally scrollable", () => {
  it("dialog content caps at the viewport and scrolls in Y", () => {
    const src = read("src/components/ui/dialog.tsx");
    expect(src).toContain("max-h-[calc(100dvh-2rem)]");
    expect(src).toContain("overflow-y-auto");
  });

  it("alert dialog content carries the same cap", () => {
    const src = read("src/components/ui/alert-dialog.tsx");
    expect(src).toContain("max-h-[calc(100dvh-2rem)]");
    expect(src).toContain("overflow-y-auto");
  });

  it("drawer content caps at 96dvh and scrolls in Y", () => {
    const src = read("src/components/ui/drawer.tsx");
    expect(src).toContain("max-h-[96dvh]");
    expect(src).toContain("overflow-y-auto");
  });

  it("command lists never exceed the viewport on short screens", () => {
    const src = read("src/components/ui/command.tsx");
    expect(src).toContain("max-h-[min(300px,calc(100dvh-6rem))]");
    expect(src).not.toContain('"max-h-[300px]');
  });
});

describe("popper panels keep a collision margin from the screen edge", () => {
  // With Radix's default collisionPadding of 0 a capped menu can sit
  // flush against the viewport edge (under the Android gesture bar /
  // iOS home indicator). The shared contents default to 8px of
  // collision padding; callers may still override per use.
  it("dropdown menu content and subcontent default collisionPadding to 8", () => {
    const src = read("src/components/ui/dropdown-menu.tsx");
    const defaults = src.match(/collisionPadding = 8/g) ?? [];
    expect(defaults.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain("collisionPadding={collisionPadding}");
  });

  it("popover, context menu and menubar contents default collisionPadding to 8", () => {
    for (const rel of [
      "src/components/ui/popover.tsx",
      "src/components/ui/context-menu.tsx",
      "src/components/ui/menubar.tsx",
    ]) {
      const src = read(rel);
      expect(src).toContain("collisionPadding = 8");
      expect(src).toContain("collisionPadding={collisionPadding}");
    }
  });
});
