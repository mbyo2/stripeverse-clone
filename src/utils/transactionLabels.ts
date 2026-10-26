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
//   3. A user-to-user transfer writes ONE description from the
//      SENDER's side ("Send money to X", "Transfer to X") and the RPC
//      copies it onto the recipient's incoming row, where it names
//      the RECIPIENT, not the sender — and the row carries no sender
//      name at all. Echoing it verbatim made the recipient's history
//      read "Send money to QA Business (incl. K5 fee)" for money they
//      RECEIVED (Money QA send re-test). An incoming row with a
//      sender-voice description therefore reads "Received from
//      BMaGlass user" — the counterparty the data can honestly name.
//   4. Any other row with a description uses it (matching the Wallet
//      page); only a row with neither keeps the legacy "Unknown".
//   5. Card-funding rows (category "card_funding") are titled
//      "Card funding"; their counterparty is the user's own virtual
//      card — "To virtual card ••••<last4>" when the caller resolved
//      the masked number from virtual_card_id, else "To virtual
//      card". Never "Unknown", never the raw FUND- reference.

export interface LabelableTransaction {
  direction?: string | null;
  recipient_name?: string | null;
  description?: string | null;
  category?: string | null;
  virtual_card_id?: string | null;
  /** Masked number (e.g. "**** **** **** 3696") of the virtual card a
   * card-funding row belongs to, when the caller resolved it from
   * virtual_card_id. Only the last four digits are ever rendered. */
  card_masked_number?: string | null;
}

const INTERNAL_CATEGORIES = new Set([
  "savings_deposit",
  "savings_withdrawal",
  "internal_transfer",
]);

export function isInternalTransaction(tx: LabelableTransaction): boolean {
  return !!tx.category && INTERNAL_CATEGORIES.has(tx.category);
}

/**
 * Card-funding rows (category "card_funding", written by
 * fund-virtual-card) move money from the user's wallet to their OWN
 * virtual card. They carry no recipient_name and no description —
 * only the virtual_card_id and a machine reference
 * ("FUND-<cardId>-<ts>") — so every generic fallback used to render
 * them as "Sent to Unknown" (or as the raw reference / category
 * string). They get their own label, like internal movements.
 */
export function isCardFundingTransaction(tx: LabelableTransaction): boolean {
  return tx.category === "card_funding";
}

/** "To virtual card ••••3696" — last four only, when resolvable. */
export function cardFundingCounterparty(tx: LabelableTransaction): string {
  const digits = (tx.card_masked_number || "").replace(/\D/g, "");
  const last4 = digits.length >= 4 ? digits.slice(-4) : null;
  const cardRef = last4 ? `virtual card ••••${last4}` : "virtual card";
  return tx.direction === "incoming" ? `From ${cardRef}` : `To ${cardRef}`;
}

const SENDER_VOICE_DESCRIPTION = /^(send money|transfer) to\s/i;

/**
 * True when an INCOMING row's description was written from the
 * sender's perspective ("Send money to …" / "Transfer to …"). The
 * atomic-transfer RPC copies the sender's single description onto
 * both ledger rows and stores no sender name on the incoming row, so
 * the description names the viewer themselves — it must not be
 * echoed as the row's label.
 */
export function hasSenderVoiceDescription(tx: LabelableTransaction): boolean {
  return (
    tx.direction === "incoming" &&
    !isInternalTransaction(tx) &&
    !!tx.description &&
    SENDER_VOICE_DESCRIPTION.test(tx.description.trim())
  );
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
  if (isCardFundingTransaction(tx)) return cardFundingCounterparty(tx);
  if (isInternalTransaction(tx)) return tx.description || internalCategoryLabel(tx);
  if (hasSenderVoiceDescription(tx)) return "BMaGlass user";
  if (tx.description) return tx.description;
  return "Unknown";
}

/** The full row title, as the Transactions list renders it. */
export function transactionTitle(tx: LabelableTransaction): string {
  if (tx.recipient_name) {
    return `${tx.direction === "outgoing" ? "Sent to" : "Received from"} ${tx.recipient_name}`;
  }
  if (isCardFundingTransaction(tx)) return "Card funding";
  if (isInternalTransaction(tx)) return tx.description || internalCategoryLabel(tx);
  if (hasSenderVoiceDescription(tx)) return "Received from BMaGlass user";
  if (tx.description) return tx.description;
  return `${tx.direction === "outgoing" ? "Sent to" : "Received from"} Unknown`;
}
