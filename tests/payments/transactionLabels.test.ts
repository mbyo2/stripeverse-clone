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

  it("does not echo the sender's description on the recipient's incoming row (Money QA send re-test)", () => {
    // The atomic-transfer RPC copies the sender's one description
    // onto both rows; qa2's incoming row literally read
    // "Send money to QA Business (incl. K5 fee)" — naming qa2
    // themselves and claiming the fee arrived. The row carries no
    // sender name, so the honest label names the platform counterparty.
    expect(transactionTitle({
      direction: "incoming",
      category: "transfer",
      description: "Send money to QA Business (incl. K5 fee)",
      recipient_name: null,
    })).toBe("Received from BMaGlass user");
    expect(transactionTitle({
      direction: "incoming",
      category: "transfer",
      description: "Transfer to +260 97 000 0001",
      recipient_name: null,
    })).toBe("Received from BMaGlass user");
  });

  it("keeps sender-side rendering of the same description unchanged", () => {
    expect(transactionTitle({
      direction: "outgoing",
      category: "transfer",
      description: "Send money to QA Business",
      recipient_name: null,
    })).toBe("Send money to QA Business");
    expect(transactionTitle({
      direction: "outgoing",
      category: "transfer",
      description: "Send money to QA Business",
      recipient_name: "QA Business",
    })).toBe("Sent to QA Business");
  });

  it("still uses a genuine incoming description that is not sender-voice", () => {
    expect(transactionTitle({
      direction: "incoming",
      category: "transfer",
      description: "Rent for June",
      recipient_name: null,
    })).toBe("Rent for June");
  });

  it("does not apply the sender-voice rule to internal rows", () => {
    expect(transactionTitle({
      direction: "incoming",
      category: "internal_transfer",
      description: "Transfer to own account",
      recipient_name: null,
    })).toBe("Transfer to own account");
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

  it("labels the dashboard Recent Activity rows (Money QA Round 2)", () => {
    // qa@'s pre-existing savings rows reached the dashboard with
    // recipient_name NULL and rendered "Unknown" there (the old
    // get_recent_transactions RPC even pre-filled 'Unknown' in SQL).
    // Fed the raw row, the shared rule yields the real descriptions.
    expect(transactionCounterpartyLabel({
      direction: "incoming",
      category: "savings_withdrawal",
      description: "Withdrawal from savings goal",
      recipient_name: null,
    })).toBe("Withdrawal from savings goal");
    expect(transactionCounterpartyLabel({
      direction: "outgoing",
      category: "savings_deposit",
      description: "Deposit to savings goal",
      recipient_name: null,
    })).toBe("Deposit to savings goal");
  });

  it("labels an incoming transfer's counterparty without echoing the sender's note", () => {
    expect(transactionCounterpartyLabel({
      direction: "incoming",
      category: "transfer",
      description: "Send money to QA Business (incl. K5 fee)",
      recipient_name: null,
    })).toBe("BMaGlass user");
    // Sender side untouched: the outgoing row's counterparty is the
    // recipient_name, and a sender-voice description on an OUTGOING
    // row still reads as written.
    expect(transactionCounterpartyLabel({
      direction: "outgoing",
      category: "transfer",
      description: "Send money to QA Business",
      recipient_name: null,
    })).toBe("Send money to QA Business");
  });
});
