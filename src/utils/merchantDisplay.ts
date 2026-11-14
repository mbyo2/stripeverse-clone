// Trading name for merchant accounts (CEO decision 2026-11-14):
// the Business portal shows the merchant's TRADING name, not the
// legally registered business name. The platform owner's portal
// shows "BMaGlass Pay" (trading_name on their merchant_accounts
// row) while the row keeps the registered name
// ("MABVUTO BANDA SCIENCE, INFORMATION TECHNICAL CONSULTANCY")
// exactly as registered. Every other merchant is unaffected:
// trading_name NULL/blank falls back to business_name.

export interface MerchantNameSource {
  trading_name?: string | null;
  business_name?: string | null;
}

/** The name the Business portal displays for a merchant. */
export function displayBusinessName(
  merchant: MerchantNameSource | null | undefined,
  fallback = "Business Portal",
): string {
  const trading = merchant?.trading_name?.trim();
  if (trading) return trading;
  const registered = merchant?.business_name?.trim();
  if (registered) return registered;
  return fallback;
}

/**
 * True when the merchant has a trading name that differs from the
 * registered name — i.e. the profile should ALSO show the
 * "Registered business name: …" line so the record stays truthful.
 */
export function hasDistinctTradingName(
  merchant: MerchantNameSource | null | undefined,
): boolean {
  const trading = merchant?.trading_name?.trim();
  const registered = merchant?.business_name?.trim();
  return !!trading && !!registered && trading !== registered;
}
