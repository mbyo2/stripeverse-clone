// Class pin: every internal navigation target written as a literal in
// src must resolve to a route actually declared in AnimatedRoutes.
//
// Why this exists (2026-10-26): the wallet's VirtualCardList sent its
// Details / Freeze / Add Funds actions to `/virtual-card/...`, but the
// declared routes are `/card/:id` and `/card/:id/fund` — all three
// actions landed on the catch-all 404. The navigation audit had
// verified the card flows through the Cards pages, so this second,
// wallet-list copy of the links escaped it. One-off fixes rot; this
// test re-runs the whole sweep mechanically on every suite run:
//
//   1. extract every declared `path="..."` from AnimatedRoutes
//   2. extract every navigation-target literal from src:
//        - navigate("..." | `...`) first arguments
//        - to="..." / to={`...`} attributes (Link / NavLink / Navigate)
//        - href="..." / href={`...`} attributes
//        - window.location(.href) = "..." assignments
//        - data-object properties that feed dynamic navigate()/Link
//          rendering:  path: / href: / to: / route: / link:  literals
//   3. normalise each target (strip ?query and #hash, turn ${...} and
//      {...} segments into :param) and require a segment-wise match
//      against the declared routes. The bare "*" catch-all never
//      counts as a match — matching it IS the 404.
//
// Deliberate exclusions (each commented at its site):
//   - targets not starting with "/" (external http/mailto/tel links,
//     "#..." in-page anchors, values built entirely from variables)
//   - ALLOWLISTED_TARGETS below: static files served from public/,
//     not router routes. Each entry is itself verified: the file must
//     exist under public/ or this test fails.
//   - API_ENDPOINT_DOC_FILES: the developer-API endpoint tables in
//     ApiReference.tsx and Developers.tsx use `path:` for HTTP API
//     endpoints relative to the developer-api base URL (paired with a
//     `method:` field) — documentation data, never router navigation.
//     Only the `path:` property kind is skipped in those two files;
//     their navigate/to/href targets are still checked.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const srcRoot = path.join(repoRoot, "src");
const routesFile = path.join(srcRoot, "components/AnimatedRoutes.tsx");

// Static assets under public/ that are legitimately linked with an
// absolute path but are not router routes.
const ALLOWLISTED_TARGETS: Record<string, string> = {
  "/openapi.json": "public/openapi.json", // the shipped OpenAPI contract
};

// Files whose `path:` object properties describe developer-API HTTP
// endpoints (documentation tables), not app navigation.
const API_ENDPOINT_DOC_FILES = new Set([
  "components/business/docs/ApiReference.tsx",
  "pages/Developers.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function declaredRoutes(): Set<string> {
  const text = fs.readFileSync(routesFile, "utf8");
  const routes = new Set<string>();
  for (const m of text.matchAll(/path\s*=\s*"([^"]+)"/g)) routes.add(m[1]);
  for (const m of text.matchAll(/path\s*=\s*'([^']+)'/g)) routes.add(m[1]);
  return routes;
}

function matchesDeclaredRoute(target: string, routes: Set<string>): boolean {
  if (routes.has(target)) return true;
  const tSegs = target.split("/").filter(Boolean);
  for (const rp of routes) {
    if (rp === "*") continue; // the catch-all is the 404 itself
    const rSegs = rp.split("/").filter(Boolean);
    if (rSegs[rSegs.length - 1] === "*") {
      // Prefixed splat (e.g. /checkout/*): the static prefix must match.
      const base = rSegs.slice(0, -1);
      if (base.every((s, i) => tSegs[i] === s) && tSegs.length >= base.length) return true;
      continue;
    }
    if (rSegs.length !== tSegs.length) continue;
    if (rSegs.every((s, i) => s.startsWith(":") || s === tSegs[i])) return true;
  }
  return false;
}

function normalise(raw: string): string {
  return raw
    .split("?")[0]
    .split("#")[0]
    .replace(/\$\{[^}]*\}/g, ":param")
    .replace(/\{[^}]*\}/g, ":param");
}

interface Target {
  file: string;
  line: number;
  kind: string;
  raw: string;
}

const CALL_AND_ATTR_PATTERNS: Array<[string, RegExp]> = [
  ["navigate", /navigate\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g],
  ["to", /\bto\s*=\s*\{?\s*(`[^`]*`|"[^"]*"|'[^']*')/g],
  ["href", /\bhref\s*=\s*\{?\s*(`[^`]*`|"[^"]*"|'[^']*')/g],
  ["window.location", /window\.location(?:\.href)?\s*=\s*(`[^`]*`|"[^"]*"|'[^']*')/g],
];

const PROPERTY_PATTERN =
  /\b(path|href|to|route|link)\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/g;

function extractTargets(): Target[] {
  const targets: Target[] = [];
  for (const file of walk(srcRoot)) {
    const rel = path.relative(srcRoot, file);
    const text = fs.readFileSync(file, "utf8");
    const lineOf = (idx: number) => text.slice(0, idx).split("\n").length;
    for (const [kind, re] of CALL_AND_ATTR_PATTERNS) {
      for (const m of text.matchAll(re)) {
        targets.push({ file: rel, line: lineOf(m.index), kind, raw: m[1].slice(1, -1) });
      }
    }
    for (const m of text.matchAll(PROPERTY_PATTERN)) {
      const kind = `prop:${m[1]}`;
      if (m[1] === "path" && API_ENDPOINT_DOC_FILES.has(rel)) continue;
      targets.push({ file: rel, line: lineOf(m.index), kind, raw: m[2].slice(1, -1) });
    }
  }
  return targets;
}

describe("route target literals resolve to declared routes", () => {
  const routes = declaredRoutes();
  const targets = extractTargets();
  const internal = targets.filter((t) => t.raw.startsWith("/"));

  it("extraction is not vacuous (regex rot would silently pass)", () => {
    expect(routes.size).toBeGreaterThan(50);
    expect(internal.length).toBeGreaterThan(300);
  });

  it("every allowlisted static-asset target exists under public/", () => {
    for (const rel of Object.values(ALLOWLISTED_TARGETS)) {
      expect(fs.existsSync(path.join(repoRoot, "public", path.basename(rel))), rel).toBe(true);
    }
  });

  it("no internal navigation literal is a dead route", () => {
    const dead: string[] = [];
    for (const t of internal) {
      const norm = normalise(t.raw);
      if (norm in ALLOWLISTED_TARGETS) continue;
      if (!matchesDeclaredRoute(norm, routes)) {
        dead.push(`${t.file}:${t.line} [${t.kind}] ${JSON.stringify(t.raw)}`);
      }
    }
    expect(dead, `Dead navigation targets:\n${dead.join("\n")}`).toEqual([]);
  });

  it("the wallet card actions use the canonical /card routes (2026-10-26 regression)", () => {
    const list = fs.readFileSync(
      path.join(srcRoot, "components/wallet/VirtualCardList.tsx"),
      "utf8",
    );
    const manager = fs.readFileSync(
      path.join(srcRoot, "components/wallet/VirtualCardManager.tsx"),
      "utf8",
    );
    for (const src of [list, manager]) {
      expect(src).not.toContain("/virtual-card/");
      expect(src).toContain("navigate(`/card/${card");
    }
    // Fund must carry the id in the path: VirtualCardFund reads it via
    // useParams on /card/:id/fund — location.state was never read.
    expect(list).toContain("navigate(`/card/${cardId}/fund`)");
    const fund = fs.readFileSync(path.join(srcRoot, "pages/VirtualCardFund.tsx"), "utf8");
    expect(fund).toContain("useParams");
  });
});
