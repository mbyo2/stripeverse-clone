// Workstream C pins: stale-chunk auto-recovery for route chunks
// (completing the 2026-10-22 owed item "stale-file auto-refresh"
// app-wide; the Spark SDK chunk already had its own guard) and the
// connection-aware wallet-route prefetch decision.

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { handleChunkPreloadError } from "../../src/lib/chunkRecovery";
import { shouldPrefetch } from "../../src/lib/routePrefetch";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

describe("handleChunkPreloadError — reload exactly once", () => {
  it("first failure: marks, reloads, and reports recovery", () => {
    const mark = vi.fn();
    const reload = vi.fn();
    const recovered = handleChunkPreloadError({
      alreadyReloaded: false,
      markReloadAttempted: mark,
      reload,
    });
    expect(recovered).toBe(true);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("second failure: no reload (loop-proof), error propagates honestly", () => {
    const mark = vi.fn();
    const reload = vi.fn();
    const recovered = handleChunkPreloadError({
      alreadyReloaded: true,
      markReloadAttempted: mark,
      reload,
    });
    expect(recovered).toBe(false);
    expect(mark).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("chunk recovery wiring", () => {
  it("is installed at app startup and re-armed on successful navigation", () => {
    expect(read("../../src/main.tsx")).toContain("installChunkRecovery()");
    expect(read("../../src/components/AnimatedRoutes.tsx")).toContain("noteChunkLoadSuccess()");
  });

  it("uses its own storage key, distinct from the Spark SDK chunk guard", () => {
    const recovery = read("../../src/lib/chunkRecovery.ts");
    const spark = read("../../src/lib/selfcustody/spark.ts");
    expect(recovery).toContain("bmaglass.routeChunkReload.v1");
    expect(spark).toContain("bmaglass.sparkChunkReload.v1");
  });
});

describe("shouldPrefetch — data discipline", () => {
  it("allows prefetch when connection facts are unknown or fast", () => {
    expect(shouldPrefetch(undefined)).toBe(true);
    expect(shouldPrefetch({})).toBe(true);
    expect(shouldPrefetch({ effectiveType: "4g" })).toBe(true);
    expect(shouldPrefetch({ effectiveType: "3g" })).toBe(true);
  });

  it("skips prefetch on data-saver or 2G-class connections", () => {
    expect(shouldPrefetch({ saveData: true, effectiveType: "4g" })).toBe(false);
    expect(shouldPrefetch({ effectiveType: "2g" })).toBe(false);
    expect(shouldPrefetch({ effectiveType: "slow-2g" })).toBe(false);
  });
});

describe("wallet prefetch wiring", () => {
  it("App warms the wallet chunks on idle once a user is signed in", () => {
    const app = read("../../src/App.tsx");
    expect(app).toContain("WalletRoutePrefetcher");
    expect(app).toContain("scheduleIdle(prefetchWalletRoutes)");
  });
});
