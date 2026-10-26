// Parent rendered-pass blemishes (2026-10-26) — five fixes pinned.
//
// The completion programme's rendered pass proved the money paths
// but found five surface defects:
//   F1 card funding charged its K2 fee without ever showing it, and
//      history lists titled funding rows with the raw FUND- ledger
//      reference (card page) or "Sent to Unknown" (main history).
//   F2 the card page named the product after a card network brand
//      ("… Virtual Card" from the stored provider) although the
//      cards are internal BMaGlass wallet cards.
//   F3 saved card limits rendered stale until a full reload.
//   F4 the create form disabled Create at K0 funding, forcing a
//      paid fund before a card could exist.
//   F5 a frozen user's dashboard looked completely normal until a
//      send was refused.
//
// These tests pin the label/fee maths behaviourally, the limits
// cache write with a real QueryClient, and the wiring at source
// level (the repo's SQL-proof pattern) where the behaviour lives in
// components.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/react-query";
import {
  transactionTitle,
  transactionCounterpartyLabel,
  isCardFundingTransaction,
} from "../../src/utils/transactionLabels";
import {
  cardFundingFee,
  cardFundingTotal,
  cardHistoryLabel,
} from "../../src/utils/cardFunding";
import { applyCardLimitsToCache } from "../../src/utils/cardCache";
import {
  shouldShowFrozenBanner,
  FROZEN_BANNER_TITLE,
  FROZEN_BANNER_MESSAGE,
} from "../../src/utils/frozenBanner";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const FUNDING_ROW = {
  direction: "outgoing",
  recipient_name: null,
  description: null,
  category: "card_funding",
  virtual_card_id: "card-uuid-1",
  reference: "FUND-card-uuid-1-1730000000000",
};

describe("F1 — card-funding rows are labelled, never 'Unknown' or a raw reference", () => {
  it("titles a funding row 'Card funding'", () => {
    expect(isCardFundingTransaction(FUNDING_ROW)).toBe(true);
    expect(transactionTitle(FUNDING_ROW)).toBe("Card funding");
  });

  it("names the funded card by last four when the masked number is resolved", () => {
    expect(
      transactionCounterpartyLabel({
        ...FUNDING_ROW,
        card_masked_number: "**** **** **** 3696",
      }),
    ).toBe("To virtual card ••••3696");
  });

  it("degrades to 'To virtual card' (never 'Unknown') when unresolved", () => {
    expect(transactionCounterpartyLabel(FUNDING_ROW)).toBe("To virtual card");
    expect(transactionCounterpartyLabel(FUNDING_ROW)).not.toContain("Unknown");
    expect(transactionTitle(FUNDING_ROW)).not.toContain("FUND-");
  });

  it("the card's own history titles funding rows 'Card funding', not the FUND- reference", () => {
    expect(
      cardHistoryLabel({
        category: "card_funding",
        reference: "FUND-abc-1730000000000",
        description: null,
      }),
    ).toBe("Card funding");
    // Non-funding rows keep their description; a bare machine
    // reference is never used as a title for them either.
    expect(
      cardHistoryLabel({ category: "payment", reference: null, description: "Store purchase" }),
    ).toBe("Store purchase");
    expect(
      cardHistoryLabel({ category: "payment", reference: "FUND-abc-1", description: null }),
    ).not.toContain("FUND-");
  });

  it("every history composer routes card-funding rows through the shared labelling", () => {
    // The outgoing-side fallbacks that used to print the raw
    // category string / 'Transaction' for funding rows.
    expect(read("../../src/pages/TransactionList.tsx")).toContain("row.category === 'card_funding'");
    expect(read("../../src/components/wallet/TransactionHistory.tsx")).toContain("isCardFundingTransaction(transaction)");
    expect(read("../../src/pages/TransactionSearch.tsx")).toContain("isCardFundingTransaction(t)");
    expect(read("../../src/pages/Business.tsx")).toContain("isCardFundingTransaction(tx)");
    // The dashboard + /transactions resolve masked numbers.
    expect(read("../../src/hooks/useDashboardData.ts")).toContain("card_masked_number");
    expect(read("../../src/pages/TransactionList.tsx")).toContain("card_masked_number");
  });
});

describe("F1/F4 — funding fee maths: shown before confirming, zero at zero", () => {
  it("fee is 1% with a K2 minimum when funding is positive", () => {
    expect(cardFundingFee(10)).toBe(2);
    expect(cardFundingFee(100)).toBe(2);
    expect(cardFundingFee(1000)).toBe(10);
    expect(cardFundingTotal(10)).toBe(12);
  });

  it("fee is exactly 0 when funding is 0 (K0 creation charges nothing)", () => {
    expect(cardFundingFee(0)).toBe(0);
    expect(cardFundingTotal(0)).toBe(0);
  });

  it("both funding flows render the breakdown from the shared maths", () => {
    const details = read("../../src/pages/VirtualCardDetails.tsx");
    expect(details).toContain("cardFundingFee(amt)");
    expect(details).toContain("cardFundingTotal(amt)");
    const create = read("../../src/pages/VirtualCardNew.tsx");
    expect(create).toContain("cardFundingFee(formData.initialFunding)");
    expect(create).toContain("cardFundingTotal(formData.initialFunding)");
    const fund = read("../../src/pages/VirtualCardFund.tsx");
    expect(fund).toContain("cardFundingFee(parsedAmount)");
  });
});

describe("F2 — no network-brand mislabelling on virtual cards", () => {
  const cardUiFiles = [
    "../../src/pages/VirtualCardDetails.tsx",
    "../../src/pages/VirtualCardNew.tsx",
    "../../src/pages/VirtualCardFund.tsx",
    "../../src/components/wallet/VirtualCardManager.tsx",
    "../../src/components/wallet/VirtualCardList.tsx",
  ];

  it("no 'Visa' string anywhere in the virtual-card UI files", () => {
    for (const rel of cardUiFiles) {
      expect(read(rel), rel).not.toMatch(/Visa/);
    }
  });

  it("the product is named 'BMaGlass Virtual Card' on every card surface", () => {
    for (const rel of cardUiFiles) {
      expect(read(rel), rel).toContain("BMaGlass Virtual Card");
    }
  });

  it("the card page no longer derives its title from the stored provider", () => {
    const details = read("../../src/pages/VirtualCardDetails.tsx");
    expect(details).not.toContain("provider.charAt");
    const list = read("../../src/components/wallet/VirtualCardList.tsx");
    expect(list).not.toContain("{card.provider}");
  });

  it("creation requests the internal provider, and the function accepts it", () => {
    expect(read("../../src/pages/VirtualCardNew.tsx")).toContain('cardProvider: "bmaglass"');
    expect(read("../../src/components/wallet/VirtualCardManager.tsx")).toContain("provider: 'bmaglass'");
    expect(read("../../supabase/functions/create-virtual-card/index.ts")).toContain("'bmaglass'");
  });

  it("the FAQ no longer claims the cards work on card networks", () => {
    const faq = read("../../src/pages/Faq.tsx");
    expect(faq).not.toContain("anywhere Visa/Mastercard is accepted");
    expect(faq).toContain("aren't card-network cards");
  });
});

describe("F3 — saved limits render immediately (cache write on success)", () => {
  it("applyCardLimitsToCache updates the cached card's limits synchronously", () => {
    const qc = new QueryClient();
    qc.setQueryData(["virtualCard", "card-1"], {
      id: "card-1",
      name: "Test",
      daily_limit: 5000,
      monthly_limit: 50000,
      transaction_limit: 2000,
      limits: { daily: 5000, monthly: 50000, transaction: 2000 },
    });
    applyCardLimitsToCache(qc, "card-1", { daily: 750, monthly: 9000, transaction: 300 });
    const cached = qc.getQueryData<any>(["virtualCard", "card-1"]);
    expect(cached.limits).toEqual({ daily: 750, monthly: 9000, transaction: 300 });
    expect(cached.daily_limit).toBe(750);
    expect(cached.monthly_limit).toBe(9000);
    expect(cached.transaction_limit).toBe(300);
    // Untouched fields survive.
    expect(cached.name).toBe("Test");
  });

  it("is a no-op when the card isn't cached yet", () => {
    const qc = new QueryClient();
    applyCardLimitsToCache(qc, "missing", { daily: 1, monthly: 2, transaction: 3 });
    expect(qc.getQueryData(["virtualCard", "missing"])).toBeUndefined();
  });

  it("the limits mutation writes the cache before invalidating", () => {
    const details = read("../../src/pages/VirtualCardDetails.tsx");
    expect(details).toContain("applyCardLimitsToCache(queryClient, id, limits)");
  });
});

describe("F4 — a card can be created with K0 funding", () => {
  it("the Create button is not disabled by a zero funding amount", () => {
    const create = read("../../src/pages/VirtualCardNew.tsx");
    expect(create).toContain("disabled={loading || !formData.cardName}");
    expect(create).not.toContain("formData.initialFunding <= 0");
  });

  it("the funding step (and its fee) only runs when funding is positive", () => {
    const create = read("../../src/pages/VirtualCardNew.tsx");
    expect(create).toContain("if (funding > 0)");
    expect(create).toContain("const fee = funding > 0 ? Math.max(funding * 0.01, 2) : 0;");
  });
});

describe("F5 — frozen users see a dashboard banner", () => {
  it("shows only for a frozen own profile", () => {
    expect(shouldShowFrozenBanner({ is_frozen: true })).toBe(true);
    expect(shouldShowFrozenBanner({ is_frozen: false })).toBe(false);
    expect(shouldShowFrozenBanner({ is_frozen: null })).toBe(false);
    expect(shouldShowFrozenBanner(null)).toBe(false);
    expect(shouldShowFrozenBanner(undefined)).toBe(false);
    expect(shouldShowFrozenBanner({})).toBe(false);
  });

  it("uses the crafted frozen copy family with the support remedy", () => {
    expect(FROZEN_BANNER_TITLE).toBe("Your account is currently frozen");
    expect(FROZEN_BANNER_MESSAGE).toContain("contact support");
  });

  it("the dashboard wires the banner to the signed-in user's profile", () => {
    const dash = read("../../src/pages/Dashboard.tsx");
    expect(dash).toContain("shouldShowFrozenBanner(profile)");
    expect(dash).toContain("<FrozenAccountBanner />");
    const profile = read("../../src/hooks/useProfile.ts");
    expect(profile).toContain("is_frozen");
  });
});
