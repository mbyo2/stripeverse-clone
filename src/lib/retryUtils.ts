/**
 * Retry logic with exponential backoff and idempotency key support.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

const defaultOptions: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  shouldRetry: (error: unknown, attempt: number) => {
    // Don't retry on 4xx errors (client errors) except 429 (rate limit)
    if (error instanceof Error && error.message.includes("4")) {
      return error.message.includes("429");
    }
    return true;
  },
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt + 1}/${opts.maxRetries + 1} failed:`, error);

      if (attempt === opts.maxRetries || !opts.shouldRetry(error, attempt)) {
        break;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
        opts.maxDelayMs
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Generate a unique idempotency key for a payment operation.
 */
export function generateIdempotencyKey(
  userId: string,
  action: string,
  amount?: number
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${action}_${userId}_${amount || 0}_${timestamp}_${random}`;
}

/**
 * Graceful degradation wrapper. Returns fallback value on failure.
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  logPrefix?: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.warn(`${logPrefix || "Operation"} failed, using fallback:`, error);
    return fallback;
  }
}
