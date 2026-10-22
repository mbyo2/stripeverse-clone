// Extract the REAL error message from a failed supabase.functions.invoke.
//
// When an edge function answers with a non-2xx status, supabase-js
// resolves with a FunctionsHttpError whose message is the generic
// "Edge Function returned a non-2xx status code" — the function's own
// { error: "..." } body sits unread in error.context (the raw
// Response). Surfacing only the generic message is how a money action
// ends up failing "silently": the user learns nothing about what
// actually went wrong (Round 2 send QA: the server was answering
// "permission denied for function execute_atomic_transfer" while the
// UI had nothing real to show).
//
// This helper reads the body when one is available and otherwise
// falls back to the error's own message, then to the caller's
// fallback. It never throws.

interface InvokeErrorLike {
  message?: string;
  context?: unknown;
}

const GENERIC_INVOKE_MESSAGE = "Edge Function returned a non-2xx status code";

async function messageFromContext(context: unknown): Promise<string | null> {
  if (!context || typeof context !== "object") return null;
  const response = context as { clone?: unknown; json?: unknown };
  if (typeof response.json !== "function") return null;
  try {
    // Clone when possible: a Response body can only be consumed once.
    const readable =
      typeof response.clone === "function"
        ? (response.clone as () => unknown).call(context)
        : context;
    const payload = await (readable as { json: () => Promise<unknown> }).json();
    if (payload && typeof payload === "object") {
      const message = (payload as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // Body wasn't JSON or was already consumed — fall through.
  }
  return null;
}

export async function resolveEdgeFunctionError(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): Promise<string> {
  if (error && typeof error === "object") {
    const invokeError = error as InvokeErrorLike;
    const fromBody = await messageFromContext(invokeError.context);
    if (fromBody) return fromBody;
    if (
      typeof invokeError.message === "string" &&
      invokeError.message.trim() &&
      invokeError.message !== GENERIC_INVOKE_MESSAGE
    ) {
      return invokeError.message;
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
