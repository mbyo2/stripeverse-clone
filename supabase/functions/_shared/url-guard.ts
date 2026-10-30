/**
 * Validate an outbound URL for webhook delivery.
 * Blocks non-HTTPS, loopback, private, link-local, and dangerous schemes.
 */
export function assertSafeWebhookUrl(raw: string): URL {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('Invalid webhook URL') }
  if (u.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS')
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||          // link-local / cloud metadata
    /^fe80:/i.test(host) ||              // IPv6 link-local
    /^fc[0-9a-f]{2}:/i.test(host) ||     // IPv6 unique-local
    /^fd[0-9a-f]{2}:/i.test(host)
  ) throw new Error('Webhook URL host not allowed')
  return u
}