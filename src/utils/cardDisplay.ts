/**
 * Display formatting for virtual cards.
 *
 * Live `virtual_cards.expiry_date` is a DATE (verified against
 * information_schema, 2026-10-23), so rows arrive as 'YYYY-MM-DD'.
 * Card surfaces display expiry in the conventional MM/YY form.
 * Anything that doesn't look like an ISO date is returned unchanged
 * rather than mangled.
 */
export function formatCardExpiry(expiryDate: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(expiryDate);
  if (!match) return expiryDate;
  return `${match[2]}/${match[1].slice(2)}`;
}
