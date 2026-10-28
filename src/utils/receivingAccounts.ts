// Local receiving accounts (virtual USD / EUR / GBP) — pure helpers.
//
// The honesty invariant lives here: account details are displayable
// ONLY when the account has actually been assigned details issued by
// a live partner (status 'assigned' or 'active') AND the fields for
// its currency are present. A requested / pending_partner / suspended
// / closed account renders NO account-number-like strings, ever —
// the platform never invents IBANs, routing numbers or sort codes.

export const RECEIVING_CURRENCIES = ["USD", "EUR", "GBP"] as const;
export type ReceivingCurrency = (typeof RECEIVING_CURRENCIES)[number];

export type ReceivingAccountStatus =
  | "requested"
  | "pending_partner"
  | "assigned"
  | "active"
  | "suspended"
  | "closed";

export type ReceivingPartnerStatus = "prospect" | "onboarding" | "live";

export type ReceivingDepositStatus = "recorded" | "credited" | "rejected";

export interface ReceivingPartner {
  id: string;
  name: string;
  currencies: string[];
  status: ReceivingPartnerStatus;
  notes: string | null;
  created_at: string;
}

export interface ReceivingAccount {
  id: string;
  user_id: string;
  partner_id: string | null;
  currency: string;
  status: ReceivingAccountStatus;
  account_holder_name: string | null;
  routing_number: string | null;
  account_number: string | null;
  iban: string | null;
  bic: string | null;
  sort_code: string | null;
  assigned_at: string | null;
  created_at: string;
}

export interface ReceivingDeposit {
  id: string;
  receiving_account_id: string;
  user_id: string;
  amount: number;
  currency: string;
  sender_name: string | null;
  sender_reference: string | null;
  status: ReceivingDepositStatus;
  credited_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export function isReceivingCurrency(value: string): value is ReceivingCurrency {
  return (RECEIVING_CURRENCIES as readonly string[]).includes(value);
}

/** Statuses in which partner-issued details may be shown to the user. */
export function detailsMayBeShown(account: ReceivingAccount): boolean {
  return account.status === "assigned" || account.status === "active";
}

export interface ReceivingDetailField {
  label: string;
  value: string;
}

/**
 * The labelled detail rows for an account, or an empty list when
 * nothing may be shown. This is the ONLY function the UI uses to get
 * account-number-like strings, so the no-details-no-display invariant
 * has exactly one gate.
 */
export function receivingDetailFields(
  account: ReceivingAccount,
): ReceivingDetailField[] {
  if (!detailsMayBeShown(account)) return [];
  const fields: ReceivingDetailField[] = [];
  if (account.account_holder_name) {
    fields.push({ label: "Account holder", value: account.account_holder_name });
  }
  if (account.currency === "USD") {
    if (account.routing_number) {
      fields.push({ label: "Routing number", value: account.routing_number });
    }
    if (account.account_number) {
      fields.push({ label: "Account number", value: account.account_number });
    }
  } else if (account.currency === "EUR") {
    if (account.iban) fields.push({ label: "IBAN", value: account.iban });
    if (account.bic) fields.push({ label: "BIC / SWIFT", value: account.bic });
  } else if (account.currency === "GBP") {
    if (account.sort_code) {
      fields.push({ label: "Sort code", value: account.sort_code });
    }
    if (account.account_number) {
      fields.push({ label: "Account number", value: account.account_number });
    }
  }
  // Details are only complete when the currency's required fields are
  // all present; a partial record shows nothing rather than half an
  // account a client could send money to by mistake.
  const required =
    account.currency === "USD"
      ? ["Routing number", "Account number"]
      : account.currency === "EUR"
        ? ["IBAN"]
        : ["Sort code", "Account number"];
  const labels = fields.map((f) => f.label);
  if (!required.every((r) => labels.includes(r))) return [];
  return fields;
}

export function hasDisplayableDetails(account: ReceivingAccount): boolean {
  return receivingDetailFields(account).length > 0;
}

/** Plain-language status copy for the user surface. Never promises a date. */
export function receivingAccountStatusCopy(
  status: ReceivingAccountStatus,
): string {
  switch (status) {
    case "requested":
      return "Requested — we're preparing your account with our banking partner. We'll notify you when your details are ready.";
    case "pending_partner":
      return "Being set up with our banking partner. We'll notify you when your details are ready.";
    case "assigned":
      return "Your details are ready — your account is being activated.";
    case "active":
      return "Active — clients can pay you using these details.";
    case "suspended":
      return "Paused — contact support if you need this account.";
    case "closed":
      return "Closed.";
    default:
      return "";
  }
}

export function receivingDepositStatusCopy(
  status: ReceivingDepositStatus,
): string {
  switch (status) {
    case "recorded":
      return "Received — being credited to your wallet.";
    case "credited":
      return "Credited to your wallet.";
    case "rejected":
      return "Could not be credited — contact support.";
    default:
      return "";
  }
}

/** Crafted copy for request_receiving_account outcomes. */
export function requestOutcomeMessage(outcome: string): string {
  switch (outcome) {
    case "requested":
      return "Request noted — we'll notify you when your account details are ready.";
    case "already_exists":
      return "You already have a receiving account request for this currency.";
    case "kyc_required":
      return "Verify your identity first — receiving accounts are issued in your legal name, so we need your completed KYC before we can request one.";
    case "feature_not_enabled":
      return "Receiving accounts are being set up and aren't open for requests yet.";
    case "invalid_currency":
      return "That currency isn't available for receiving accounts.";
    case "unauthenticated":
      return "Please sign in again, then retry.";
    default:
      return "Something went wrong on our side. Please try again.";
  }
}

export const RECEIVING_FEATURE_OFF_COPY =
  "Receiving accounts are being set up. We're completing the work with our banking partner — when it's ready, you'll be able to get USD, EUR and GBP account details in your own name, so clients abroad can pay you like a local transfer.";

export const RECEIVING_INTRO_COPY =
  "Get account details in your own name for USD, EUR and GBP. Clients abroad pay you like a local transfer — no PayPal account needed on their side — and the money lands in your BMaGlass wallet in that currency.";
