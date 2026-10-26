// Card-funding money maths + history labels, shared by every surface
// that funds a virtual card (card page, fund page, create-with-funding)
// so the fee the user sees before confirming is always the fee the
// fund-virtual-card function charges: 1% of the amount, minimum K2 —
// and NO fee at all when the funding amount is 0 (creating a card
// with no initial funding calls no funding step and writes no fee).

export function cardFundingFee(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(amount * 0.01, 2);
}

export function cardFundingTotal(amount: number): number {
  const safe = Number.isFinite(amount) && amount > 0 ? amount : 0;
  return safe + cardFundingFee(safe);
}

interface CardHistoryRow {
  category?: string | null;
  reference?: string | null;
  description?: string | null;
}

/**
 * The label for one row of a card's own transaction history.
 * Funding rows are titled "Card funding" — never the raw ledger
 * reference ("FUND-<uuid>-<ts>") the row carries, which the old
 * mapping preferred over every human field. Other rows keep their
 * description; a bare machine reference is never shown as a title.
 */
export function cardHistoryLabel(tx: CardHistoryRow): string {
  if (tx.category === "card_funding") return "Card funding";
  if (tx.description) return tx.description;
  if (tx.reference && !/^FUND-/i.test(tx.reference)) return tx.reference;
  return tx.category || "Card transaction";
}
