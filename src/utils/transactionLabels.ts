// One labelling rule for transaction rows, shared by every list that
// renders them, so the same ledger row reads the same everywhere.
//
// The Wallet page's history renders the row's description, which the
// money RPCs always write for internal movements ("Deposit to savings
// goal", "Withdrawal from savings goal", the sender's transfer note).
// The Transactions page instead composed "Sent to / Received from
// {recipient_name}" — and internal rows have no recipient_name (the
// counterparty is the user's OWN account), so they all rendered as
// "Sent to Unknown" / "Received from Unknown" for movements that were
// fully identified in the data.
//
// Rule:
//   1. A real recipient_name wins: "Sent to X" / "Received from X".
//   2. Internal categories (own-account movements) use the row's
//      description, falling back to a category label — never "Unknown".
//   3. Any other row with a description uses it (matching the Wallet
//      page); only a row with neither keeps the legacy "Unknown".

export interface LabelableTransaction {
  direction?: string | null;
  recipient_name?: string | null;
  description?: string | null;
  category?: string | null;
}

const INTERNAL_CATEGORIES = new Set([
  "savings_deposit",
  "savings_withdrawal",
  "internal_transfer",
]);

export function isInternalTransaction(tx: LabelableTransaction): boolean {
  return !!tx.category && INTERNAL_CATEGORIES.has(tx.category);
}

/** Category label for an internal row that carries no description. */
export function internalCategoryLabel(tx: LabelableTransaction): string {
  switch (tx.category) {
    case "savings_deposit":
      return "Deposit to savings goal";
    case "savings_withdrawal":
      return "Withdrawal from savings goal";
    case "internal_transfer":
      return tx.direction === "outgoing"
        ? "Transfer to own account"
        : "Transfer from own account";
    default:
      return tx.direction === "outgoing" ? "Sent" : "Received";
  }
}

/**
 * The counterparty/description label WITHOUT the Sent/Received prefix
 * (for exports and detail views that carry direction separately).
 */
export function transactionCounterpartyLabel(tx: LabelableTransaction): string {
  if (tx.recipient_name) return tx.recipient_name;
  if (isInternalTransaction(tx)) return tx.description || internalCategoryLabel(tx);
  if (tx.description) return tx.description;
  return "Unknown";
}

/** The full row title, as the Transactions list renders it. */
export function transactionTitle(tx: LabelableTransaction): string {
  if (tx.recipient_name) {
    return `${tx.direction === "outgoing" ? "Sent to" : "Received from"} ${tx.recipient_name}`;
  }
  if (isInternalTransaction(tx)) return tx.description || internalCategoryLabel(tx);
  if (tx.description) return tx.description;
  return `${tx.direction === "outgoing" ? "Sent to" : "Received from"} Unknown`;
}
