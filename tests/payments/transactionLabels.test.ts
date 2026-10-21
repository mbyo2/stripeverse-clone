// Unit tests for src/utils/transactionLabels.ts — the shared row
// labelling. The regression being pinned: internal movements
// (savings deposits/withdrawals, transfers between the user's own
// accounts) have no recipient_name, and the Transactions page
// rendered them "Sent to Unknown" / "Received from Unknown" while
// the Wallet page showed their real descriptions.

import { describe, it, expect } from "vitest";
import {
  transactionTitle,
  transactionCounterpartyLabel,
} from "../../src/utils/transactionLabels";

describe("transactionTitle", () => {
  it("uses the recipient name for external transfers", () => {
    expect(transactionTitle({ direction: "outgoing", recipient_name: "Jane Banda" })).toBe("Sent to Jane Banda");
    expect(transactionTitle({ direction: "incoming", recipient_name: "Jane Banda" })).toBe("Received from Jane Banda");
  });

  it("labels a savings deposit by its description, not Unknown", () => {
    expect(transactionTitle({
      direction: "outgoing",
      category: "savings_deposit",
      description: "Deposit to savings goal",
      recipient_name: null,
    })).toBe("Deposit to savings goal");
  });

  it("labels a savings withdrawal by its description, not Unknown", () => {
    expect(transactionTitle({
      direction: "incoming",
      category: "savings_withdrawal",
      description: "Withdrawal from savings goal",
      recipient_name: null,
    })).toBe("Withdrawal from savings goal");
  });

  it("falls back to the category label for internal rows without a description", () => {
    expect(transactionTitle({ direction: "outgoing", category: "internal_transfer", description: null }))
      .toBe("Transfer to own account");
    expect(transactionTitle({ direction: "incoming", category: "internal_transfer", description: null }))
      .toBe("Transfer from own account");
    expect(transactionTitle({ direction: "outgoing", category: "savings_deposit", description: null }))
      .toBe("Deposit to savings goal");
  });

  it("uses a sender's note on an internal transfer when present", () => {
    expect(transactionTitle({
      direction: "outgoing",
      category: "internal_transfer",
      description: "Stock money",
    })).toBe("Stock money");
  });

  it("uses the description for non-internal rows without a recipient name", () => {
    expect(transactionTitle({
      direction: "incoming",
      category: "deposit",
      description: "Wallet deposit via PayPal (awaiting confirmation)",
    })).toBe("Wallet deposit via PayPal (awaiting confirmation)");
  });

  it("keeps the legacy Unknown only for rows with no name and no description", () => {
    expect(transactionTitle({ direction: "outgoing" })).toBe("Sent to Unknown");
  });
});

describe("transactionCounterpartyLabel", () => {
  it("returns the bare label for exports", () => {
    expect(transactionCounterpartyLabel({ direction: "outgoing", recipient_name: "Jane Banda" })).toBe("Jane Banda");
    expect(transactionCounterpartyLabel({
      direction: "outgoing", category: "savings_deposit", description: "Deposit to savings goal",
    })).toBe("Deposit to savings goal");
    expect(transactionCounterpartyLabel({ direction: "incoming", category: "internal_transfer" }))
      .toBe("Transfer from own account");
  });
});
