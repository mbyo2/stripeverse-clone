// Crafted-error gate (Workstream D, 2026-11-15; CEO error-presentation rule:
// never show a raw browser-style/system response).
//
// Only our own crafted messages ever reach a client. Postgres RAISE
// EXCEPTIONs surface from PostgREST with code P0001 — those ARE the RPCs'
// crafted refusals (e.g. "Insufficient balance: have 0.00, need 1.03"),
// so they pass through. Every other database / provider / network error
// collapses to the caller's generic fallback. This is the same P0001
// discriminator pos/ and p2p/ already use at their RPC call sites.
//
// PostgREST errors are plain objects ({ message, code, ... }), NOT Error
// instances, so the gate reads .message/.code structurally and works for
// both shapes.
//
// Usage:
//   const { data, error } = await admin.rpc("my_rpc", {...});
//   if (error) throwRpcError(error, "Transfer failed");
//   ...
//   } catch (e) {
//     return json(400, { error: publicErrorMessage(e, "Transfer failed", [
//       "from_wallet_id required", ... // this function's own crafted throws
//     ])});
//   }
export function publicErrorMessage(
  e: unknown,
  fallback: string,
  allowed: readonly string[] = [],
): string {
  const msg = e instanceof Error
    ? e.message
    : (e as { message?: unknown } | null | undefined)?.message;
  const code = (e as { code?: unknown } | null | undefined)?.code;
  if (typeof msg === "string" && msg.length > 0) {
    if (code === "P0001") return msg;
    if (allowed.some((a) => msg === a || msg.includes(a))) return msg;
  }
  return fallback;
}

/** Throw an RPC failure preserving its Postgres code: P0001 (a crafted
 *  RAISE EXCEPTION from our own function) keeps its message; any other
 *  database error becomes the generic fallback at the throw site, so a
 *  downstream `catch (e) { error: e.message }` can never leak it. */
export function throwRpcError(
  error: { message?: string; code?: string } | null | undefined,
  fallback: string,
): never {
  const message = error?.code === "P0001" ? (error.message ?? fallback) : fallback;
  const err = new Error(message) as Error & { code?: string };
  err.code = error?.code;
  throw err;
}
