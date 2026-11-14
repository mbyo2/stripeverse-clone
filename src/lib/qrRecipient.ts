// Resolve a scanned BMaGlass payment-QR recipient by user id.
//
// The page used to select `id, full_name` from public.profiles. That
// could never work: `profiles.full_name` does not exist live (names
// live in first_name / last_name), and profiles RLS only ever returns
// the caller's OWN row — so any other user resolved to nothing and the
// pay panel never unlocked. Resolution goes through the SECURITY
// DEFINER `resolve_qr_recipient` RPC (migration 20261267) instead,
// the same pattern find_transfer_recipient established for
// SendMoney / Transfer: exact id match, one row, only the user id and
// a display name come back.

export type QrRecipient = { id: string; display_name: string | null };

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Resolve the recipient named in a scanned code. Null = no such user. */
export async function resolveQrRecipient(
  supabase: RpcClient,
  recipientId: string,
): Promise<QrRecipient | null> {
  const { data, error } = await supabase.rpc("resolve_qr_recipient", {
    p_user_id: recipientId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as { user_id?: unknown; display_name?: unknown };
  if (typeof r.user_id !== "string" || !r.user_id) return null;
  return {
    id: r.user_id,
    display_name:
      typeof r.display_name === "string" ? r.display_name : null,
  };
}
