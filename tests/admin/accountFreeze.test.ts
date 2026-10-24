// Unit tests for supabase/functions/_shared/account-freeze.ts — the
// money-out freeze guard wired into the send / transfer / payment /
// BTC edge functions by the superadmin foundation build (20261105).
// The helper is dependency-free, so it is imported directly.

import { describe, it, expect } from "vitest";
import {
  ACCOUNT_FROZEN_MESSAGE,
  ACCOUNT_STATUS_UNVERIFIED_MESSAGE,
  assertAccountNotFrozen,
  isAccountFrozen,
} from "../../supabase/functions/_shared/account-freeze";

// Minimal structural mock of the Supabase client surface the helper
// uses: from("profiles").select(...).eq(...).maybeSingle().
function mockClient(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return {
    from: (table: string) => {
      if (table !== "profiles") throw new Error("unexpected table " + table);
      return chain;
    },
  };
}

describe("account-freeze guard", () => {
  it("reports a frozen profile as frozen", async () => {
    const admin = mockClient({ data: { is_frozen: true }, error: null });
    await expect(isAccountFrozen(admin, "user-1")).resolves.toBe(true);
  });

  it("reports an unfrozen profile as not frozen", async () => {
    const admin = mockClient({ data: { is_frozen: false }, error: null });
    await expect(isAccountFrozen(admin, "user-1")).resolves.toBe(false);
  });

  it("treats a missing profile row as not frozen", async () => {
    const admin = mockClient({ data: null, error: null });
    await expect(isAccountFrozen(admin, "user-1")).resolves.toBe(false);
  });

  it("fails closed when the status read errors", async () => {
    const admin = mockClient({ data: null, error: { message: "db down" } });
    await expect(isAccountFrozen(admin, "user-1")).rejects.toThrow(
      ACCOUNT_STATUS_UNVERIFIED_MESSAGE,
    );
  });

  it("assert passes for an unfrozen account", async () => {
    const admin = mockClient({ data: { is_frozen: false }, error: null });
    await expect(assertAccountNotFrozen(admin, "user-1")).resolves.toBeUndefined();
  });

  it("assert refuses a frozen account with the crafted message", async () => {
    const admin = mockClient({ data: { is_frozen: true }, error: null });
    await expect(assertAccountNotFrozen(admin, "user-1")).rejects.toThrow(
      ACCOUNT_FROZEN_MESSAGE,
    );
  });
});
