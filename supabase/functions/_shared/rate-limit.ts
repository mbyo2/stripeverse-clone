// Shared abuse controls for BMaGlass Pay edge functions (workstream E,
// security audit 2026-11-15).
//
// All limits here are enforced through the live
// public.check_advanced_rate_limit RPC over public.rate_limits
// (per-minute buckets, SECURITY DEFINER, service_role callers only),
// the same primitive payment-link-checkout / developer-api /
// create-checkout-intent already use. Fail-open: the RPC returning
// anything other than `false` (error, null) lets the request through —
// a limiter outage must never block a money path or a real provider
// delivery. Only a definitive `false` ("over the limit") answers 429.

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Caller IP for unauthenticated ingress. Supabase sits behind a proxy,
 * so the first x-forwarded-for entry is the caller; x-real-ip is the
 * fallback (payment-link-checkout pattern). "unknown" buckets callers
 * with no forwarding headers together — still bounded, never bypassed.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  if (first) return first;
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * One limiter check. Returns true when the call is allowed, false when
 * the caller is over the limit. Never throws for a limiter failure —
 * fail-open (see header).
 */
export async function withinLimit(
  db: Db,
  identifier: string,
  action: string,
  maxAttempts: number,
  windowMinutes: number,
): Promise<boolean> {
  try {
    const { data } = await db.rpc("check_advanced_rate_limit", {
      p_identifier: identifier,
      p_action: action,
      p_max_attempts: maxAttempts,
      p_window_minutes: windowMinutes,
    });
    return data !== false;
  } catch (err) {
    console.error(`[rate-limit] ${action}: limiter threw, allowing request:`, err);
    return true;
  }
}

/**
 * Per-source-IP limit for UNAUTHENTICATED webhook ingress. Returns a
 * 429 Response when the source is over the limit, or null when the
 * request may proceed.
 */
export async function ipRateLimitResponse(
  db: Db,
  req: Request,
  action: string,
  limitPerMinute: number,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const ok = await withinLimit(db, `ip:${clientIp(req)}`, action, limitPerMinute, 1);
  if (ok) return null;
  return new Response(
    JSON.stringify({ error: "rate_limited", message: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": "60" },
    },
  );
}
