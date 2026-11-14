// QR recipient resolution (bug-free gate, 2026-11-14). These tests pin:
//   1. resolveQrRecipient calls the SECURITY DEFINER RPC with the
//      scanned user id and returns id + display_name (or null).
//   2. The QrPayments page resolves through that RPC — the old
//      `.from('profiles').select('id, full_name')` is gone: the column
//      does not exist live, and profiles RLS only ever returns the
//      caller's own row, so a direct select could never resolve any
//      other user and the pay panel never unlocked.
//   3. The migration creates the RPC as SECURITY DEFINER with
//      EXECUTE for authenticated only (anon revoked).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveQrRecipient } from "../../src/lib/qrRecipient";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  fs.readFileSync(path.resolve(here, rel), "utf8");

const RECIPIENT = "11111111-2222-3333-4444-555555555555";

const fakeRpc = (data: unknown, error: { message: string } | null = null) => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  rpc(fn: string, args: Record<string, unknown>) {
    this.calls.push({ fn, args });
    return Promise.resolve({ data, error });
  },
});

describe("resolveQrRecipient", () => {
  it("calls the RPC with the scanned user id and returns id + display name", async () => {
    const client = fakeRpc([
      { user_id: RECIPIENT, display_name: "Mabvuto Banda" },
    ]);
    const result = await resolveQrRecipient(client as never, RECIPIENT);
    expect(client.calls).toEqual([
      { fn: "resolve_qr_recipient", args: { p_user_id: RECIPIENT } },
    ]);
    expect(result).toEqual({ id: RECIPIENT, display_name: "Mabvuto Banda" });
  });

  it("returns null when the RPC finds no user", async () => {
    const client = fakeRpc([]);
    expect(await resolveQrRecipient(client as never, RECIPIENT)).toBeNull();
  });

  it("returns null display name when the user has no name on file", async () => {
    const client = fakeRpc([{ user_id: RECIPIENT, display_name: null }]);
    expect(await resolveQrRecipient(client as never, RECIPIENT)).toEqual({
      id: RECIPIENT,
      display_name: null,
    });
  });

  it("throws a plain message when the RPC errors", async () => {
    const client = fakeRpc(null, { message: "Not authenticated" });
    await expect(
      resolveQrRecipient(client as never, RECIPIENT),
    ).rejects.toThrow("Not authenticated");
  });
});

describe("QrPayments page — recipient resolution pins", () => {
  const page = read("../../src/pages/QrPayments.tsx");

  it("resolves the scanned recipient through resolve_qr_recipient", () => {
    expect(page).toContain("resolveQrRecipient(supabase, recipient)");
    expect(page).toContain("from '@/lib/qrRecipient'");
  });

  it("never selects full_name (or anything else) from profiles", () => {
    expect(page).not.toContain(".from('profiles')");
    expect(page).not.toContain("select('id, full_name')");
    expect(page).not.toContain("recipientProfile.full_name");
  });

  it("renders and pays against display_name, not full_name", () => {
    expect(page).toContain("recipientProfile.display_name");
    expect(page).not.toContain("recipientProfile.full_name");
  });
});

describe("resolve_qr_recipient migration pins", () => {
  const sql = read(
    "../../supabase/migrations/20261267_resolve_qr_recipient.sql",
  );

  it("is SECURITY DEFINER with an auth guard and an exact-id match", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("auth.uid() IS NULL");
    expect(sql).toContain("WHERE u.id = p_user_id");
  });

  it("returns only user id + display name from first/last name", () => {
    expect(sql).toContain("RETURNS TABLE(user_id uuid, display_name text)");
    expect(sql).toContain("concat_ws(' ', p.first_name, p.last_name)");
  });

  it("is executable by authenticated only", () => {
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.resolve_qr_recipient(uuid) TO authenticated",
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.resolve_qr_recipient(uuid) FROM anon",
    );
  });
});
