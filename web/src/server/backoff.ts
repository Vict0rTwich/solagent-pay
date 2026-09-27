/**
 * Exponential backoff with full jitter: a random delay in [0, min(cap, base · 2^attempt)]. The randomness spreads
 * retries out, so many callers backing off from the same rate limit don't all come back at the same moment.
 */
export function backoffDelay(attempt: number, baseMs: number, capMs: number): number {
  return Math.random() * Math.min(capMs, baseMs * 2 ** attempt);
}

/** `ms` ± `spread` (0.2 = ±20%). */
export function jitter(ms: number, spread = 0.2): number {
  return ms * (1 - spread + Math.random() * 2 * spread);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A Retry-After header (seconds or an HTTP date) in ms, or null. */
export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
