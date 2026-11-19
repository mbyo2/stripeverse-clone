// Pure logic for the superadmin Merchant Oversight surface
// (/admin/merchants): merging merchant account rows with the user
// directory (the only source of owner emails) and the search rule.
//
// The page reads merchant_accounts with an explicit SAFE column
// list — never the raw api_key or webhook_secret columns — and this
// module only ever sees those safe fields. Kept pure and
// dependency-light for unit tests (the adminConsole.ts pattern).

export interface MerchantRow {
  id: string;
  user_id: string;
  business_name: string | null;
  trading_name: string | null;
  business_type: string | null;
  registration_number: string | null;
  status: string | null;
  mobile_money_enabled: boolean | null;
  momo_fee_bearer: string | null;
  created_at: string | null;
}

export interface MerchantView extends MerchantRow {
  /** Display name: trading name first, registered name as fallback. */
  display_name: string;
  /** The registered legal name when it differs from the display name. */
  registered_name: string | null;
  owner_email: string | null;
  owner_name: string | null;
}

interface DirectoryEntry {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

/** Join merchant rows to directory entries by owner user_id.
 *  Merchants whose owner isn't in the directory (shouldn't happen —
 *  the directory lists every user) still render, with no email. */
export function mergeMerchants(
  merchants: MerchantRow[],
  directory: DirectoryEntry[],
): MerchantView[] {
  const byUser = new Map(directory.map((d) => [d.user_id, d]));
  return merchants.map((m) => {
    const owner = byUser.get(m.user_id);
    const trading = (m.trading_name ?? "").trim();
    const registered = (m.business_name ?? "").trim();
    const display = trading || registered || "Unnamed business";
    const ownerName = owner
      ? [owner.first_name, owner.last_name].filter(Boolean).join(" ").trim()
      : "";
    return {
      ...m,
      display_name: display,
      registered_name: registered && registered !== display ? registered : null,
      owner_email: owner?.email ?? null,
      owner_name: ownerName || null,
    };
  });
}

export function merchantMatchesSearch(
  merchant: MerchantView,
  search: string,
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    merchant.display_name,
    merchant.registered_name ?? "",
    merchant.owner_email ?? "",
    merchant.owner_name ?? "",
    merchant.registration_number ?? "",
    merchant.status ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

/** Plain label for a merchant account status value. */
export function merchantStatusLabel(status: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "Active";
    case "pending":
      return "Pending review";
    case "suspended":
      return "Suspended";
    case "rejected":
      return "Rejected";
    default:
      return status ? status : "Unknown";
  }
}
