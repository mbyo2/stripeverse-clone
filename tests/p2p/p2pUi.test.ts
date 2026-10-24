// Unit tests for src/utils/p2pUi.ts — the pure P2P UI logic
// (Phase 1c): the trade state machine's label/step mapping, the
// countdown maths, the §3.5 mark-paid / release form validation,
// and the price maths that mirrors p2p_create_order so what the
// user sees is what the server settles.

import { describe, it, expect } from "vitest";
import {
  adEffectivePriceZmw,
  buildP2pReceiptHtml,
  completionSummary,
  countdownTo,
  cryptoFromFiat,
  disputeReasonsFor,
  escapeHtml,
  fiatFromCrypto,
  formatBtcFromSats,
  formatCountdownLabel,
  formatSats,
  isOffMarket,
  limitsReasonText,
  maxTransferableToMainSats,
  orderSteps,
  ORDER_STATUS_META,
  percentVsIndex,
  p2pShortfallSats,
  sanctionDefaultDuration,
  slaInfo,
  traderDisplayName,
  validateMarkPaidForm,
  validateReleaseForm,
} from "../../src/utils/p2pUi";

describe("orderSteps — the trade state machine (§4.4 stepper)", () => {
  it("escrow_locked: lock done, payment step current", () => {
    const steps = orderSteps("escrow_locked");
    expect(steps.map((s) => s.state)).toEqual(["done", "current", "upcoming", "upcoming"]);
  });

  it("paid_marked: payment done, confirm step current", () => {
    const steps = orderSteps("paid_marked");
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current", "upcoming"]);
  });

  it("disputed before payment blocks the payment step", () => {
    const steps = orderSteps("disputed", { paidMarkedAt: null });
    expect(steps[1].state).toBe("blocked");
    expect(steps[0].state).toBe("done");
  });

  it("disputed after payment blocks the confirm step", () => {
    const steps = orderSteps("disputed", { paidMarkedAt: "2026-10-23T10:00:00Z" });
    expect(steps[2].state).toBe("blocked");
    expect(steps[1].state).toBe("done");
  });

  it("completed: every step done", () => {
    expect(orderSteps("completed").every((s) => s.state === "done")).toBe(true);
  });

  it("refunded collapses to a blocked final step", () => {
    const steps = orderSteps("refunded");
    expect(steps[3].state).toBe("blocked");
  });

  it("cancelled/expired block at the payment step", () => {
    expect(orderSteps("cancelled_unpaid")[1].state).toBe("blocked");
    expect(orderSteps("expired_unpaid")[1].state).toBe("blocked");
  });

  it("every status has an honest headline and terminal flag", () => {
    for (const meta of Object.values(ORDER_STATUS_META)) {
      expect(meta.headline.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
    }
    expect(ORDER_STATUS_META.completed.terminal).toBe(true);
    expect(ORDER_STATUS_META.disputed.terminal).toBe(false);
    expect(ORDER_STATUS_META.escrow_locked.terminal).toBe(false);
  });
});

describe("countdown maths", () => {
  const now = new Date("2026-10-23T12:00:00Z").getTime();

  it("formats sub-hour windows as MM:SS", () => {
    expect(formatCountdownLabel(14 * 60 * 1000 + 32 * 1000)).toBe("14:32");
    expect(formatCountdownLabel(5 * 60 * 1000)).toBe("05:00");
  });

  it("formats hours and days", () => {
    expect(formatCountdownLabel(3600 * 1000 + 5 * 60 * 1000)).toBe("1h 05m");
    expect(formatCountdownLabel(2 * 86400 * 1000 + 4 * 3600 * 1000)).toBe("2d 4h");
  });

  it("expired at zero and below", () => {
    expect(formatCountdownLabel(0)).toBe("Expired");
    expect(formatCountdownLabel(-5000)).toBe("Expired");
    const cd = countdownTo("2026-10-23T11:59:00Z", now);
    expect(cd?.expired).toBe(true);
  });

  it("computes remaining time to a target", () => {
    const cd = countdownTo("2026-10-23T12:30:00Z", now);
    expect(cd?.totalMs).toBe(30 * 60 * 1000);
    expect(cd?.expired).toBe(false);
    expect(cd?.label).toBe("30:00");
  });

  it("returns null for missing or invalid targets", () => {
    expect(countdownTo(null, now)).toBeNull();
    expect(countdownTo("not-a-date", now)).toBeNull();
  });
});

describe("price maths mirrors p2p_create_order", () => {
  const index = 2_000_000; // K2,000,000 per BTC

  it("fixed ads price at their fixed price", () => {
    expect(
      adEffectivePriceZmw({ price_type: "fixed", fixed_price_zmw: 1_950_000, margin_percent: null }, index),
    ).toBe(1_950_000);
  });

  it("margin ads price at index × (1 + margin), rounded to 2dp like the RPC", () => {
    expect(
      adEffectivePriceZmw({ price_type: "margin", fixed_price_zmw: null, margin_percent: 1.5 }, index),
    ).toBe(2_030_000);
    expect(
      adEffectivePriceZmw({ price_type: "margin", fixed_price_zmw: null, margin_percent: -2 }, index),
    ).toBe(1_960_000);
  });

  it("margin ads have no price without an index", () => {
    expect(
      adEffectivePriceZmw({ price_type: "margin", fixed_price_zmw: null, margin_percent: 1 }, null),
    ).toBeNull();
  });

  it("percentVsIndex is signed and null-safe", () => {
    expect(percentVsIndex(2_100_000, index)).toBeCloseTo(5);
    expect(percentVsIndex(1_900_000, index)).toBeCloseTo(-5);
    expect(percentVsIndex(null, index)).toBeNull();
    expect(percentVsIndex(100, 0)).toBeNull();
  });

  it("off-market is strictly more than 10% away (the §3.8 bait line)", () => {
    expect(isOffMarket(2_200_000, index)).toBe(false); // exactly +10%
    expect(isOffMarket(2_200_001, index)).toBe(true);
    expect(isOffMarket(1_800_000, index)).toBe(false); // exactly -10%
    expect(isOffMarket(1_799_999, index)).toBe(true);
    expect(isOffMarket(null, index)).toBe(false);
  });

  it("fiat → sats floors to the sat, exactly as the RPC", () => {
    // K1,000 at K2,000,000/BTC = 0.0005 BTC = 50,000 sats
    expect(cryptoFromFiat(1000, index)).toBe(50_000);
    // An amount that lands between sats floors, never rounds up:
    expect(cryptoFromFiat(1000, 3_000_000)).toBe(33_333);
  });

  it("sats → fiat rounds to the ngwee, exactly as the RPC", () => {
    expect(fiatFromCrypto(50_000, index)).toBe(1000);
    expect(fiatFromCrypto(33_333, 3_000_000)).toBe(999.99);
  });
});

describe("separate P2P account — transfer maths", () => {
  it("with zero holds, everything available can move to main", () => {
    expect(maxTransferableToMainSats(50_000, 0)).toBe(50_000);
    expect(maxTransferableToMainSats(0, 0)).toBe(0);
  });

  it("holds reduce what can move to main, sat for sat", () => {
    expect(maxTransferableToMainSats(50_000, 20_000)).toBe(30_000);
  });

  it("holds above available leave nothing transferable — never negative", () => {
    expect(maxTransferableToMainSats(10_000, 25_000)).toBe(0);
  });

  it("exact cover: holds equal to available leave zero transferable", () => {
    expect(maxTransferableToMainSats(40_000, 40_000)).toBe(0);
  });

  it("shortfall is what is still needed beyond the P2P available balance", () => {
    expect(p2pShortfallSats(50_000, 20_000)).toBe(30_000);
    expect(p2pShortfallSats(50_000, 0)).toBe(50_000);
  });

  it("shortfall is zero when the P2P account exactly covers the need", () => {
    expect(p2pShortfallSats(50_000, 50_000)).toBe(0);
  });

  it("shortfall is zero when the P2P account more than covers the need", () => {
    expect(p2pShortfallSats(50_000, 75_000)).toBe(0);
    expect(p2pShortfallSats(0, 0)).toBe(0);
  });
});

describe("mark-paid validation (§3.5 buyer side)", () => {
  const orderFiat = 1500;

  it("requires a registered method first", () => {
    const err = validateMarkPaidForm(
      { paymentMethodId: "", railReference: "ABC12345", amountSentZmw: "1500" },
      orderFiat,
    );
    expect(err).toContain("registered payment methods");
  });

  it("requires a real rail reference", () => {
    const err = validateMarkPaidForm(
      { paymentMethodId: "m1", railReference: "ab", amountSentZmw: "1500" },
      orderFiat,
    );
    expect(err).toContain("payment reference");
  });

  it("requires the amount to equal the order amount exactly", () => {
    const err = validateMarkPaidForm(
      { paymentMethodId: "m1", railReference: "MP123456", amountSentZmw: "1499.99" },
      orderFiat,
    );
    expect(err).toContain("equal the order amount exactly");
  });

  it("passes a complete, exact claim", () => {
    expect(
      validateMarkPaidForm(
        { paymentMethodId: "m1", railReference: "MP123456", amountSentZmw: "1500.00" },
        orderFiat,
      ),
    ).toBeNull();
  });
});

describe("release validation (§3.5 seller checklist)", () => {
  const good = {
    receivedAmountZmw: "1500",
    receivedReference: "MP123456",
    checkedOwnAccount: true,
    checkedFullAmount: true,
    checkedSenderName: true,
  };

  it("refuses until all three checklist boxes are ticked", () => {
    for (const key of ["checkedOwnAccount", "checkedFullAmount", "checkedSenderName"] as const) {
      const err = validateReleaseForm({ ...good, [key]: false }, 1500);
      expect(err).toContain("all three checks");
    }
  });

  it("refuses a missing typed reference", () => {
    expect(validateReleaseForm({ ...good, receivedReference: "  " }, 1500)).toContain(
      "Type the payment reference",
    );
  });

  it("refuses when the typed amount does not match the order exactly", () => {
    expect(
      validateReleaseForm({ ...good, receivedAmountZmw: "1400" }, 1500),
    ).toContain("must match the order amount exactly");
  });

  it("passes the disciplined release", () => {
    expect(validateReleaseForm(good, 1500)).toBeNull();
    expect(validateReleaseForm({ ...good, receivedAmountZmw: "1500.00" }, 1500)).toBeNull();
  });
});

describe("limits reasons → plain language", () => {
  it("maps the known codes", () => {
    expect(limitsReasonText("kyc_required")).toContain("Verify your identity");
    expect(limitsReasonText("marketplace_paused")).toContain("paused");
    expect(limitsReasonText("daily_order_cap_reached")).toContain("today's P2P order limit");
    expect(limitsReasonText("identity_review_hold")).toContain("identity review");
  });

  it("maps sanctioned rungs with their level", () => {
    expect(limitsReasonText("sanctioned_rung_2")).toContain("level 2");
  });

  it("humanises unknown codes instead of leaking them raw", () => {
    expect(limitsReasonText("some_new_reason")).toBe("some new reason");
  });
});

describe("dispute reasons follow §3.6 role/status rules", () => {
  it("buyer pre-payment gets only the auto-cancel reason", () => {
    expect(disputeReasonsFor("buyer", "escrow_locked")).toEqual([
      "seller_unresponsive_pre_payment",
    ]);
  });

  it("seller cannot dispute before payment is marked", () => {
    expect(disputeReasonsFor("seller", "escrow_locked")).toEqual([]);
  });

  it("paid-marked opens the full set for each side", () => {
    expect(disputeReasonsFor("seller", "paid_marked")).toContain("paid_not_received");
    expect(disputeReasonsFor("seller", "paid_marked")).toContain("third_party_payment");
    expect(disputeReasonsFor("buyer", "paid_marked")).toContain("seller_unresponsive");
    expect(disputeReasonsFor("buyer", "paid_marked")).not.toContain("paid_not_received");
  });

  it("completed trades give the seller the reversed-payment track", () => {
    expect(disputeReasonsFor("seller", "completed")).toContain("payment_reversed");
    expect(disputeReasonsFor("buyer", "completed")).not.toContain("payment_reversed");
  });

  it("terminal unpaid states allow nothing", () => {
    expect(disputeReasonsFor("buyer", "cancelled_unpaid")).toEqual([]);
    expect(disputeReasonsFor("seller", "refunded")).toEqual([]);
  });
});

describe("sanction durations", () => {
  it("rung 1 and 2 have the §3.9 default durations", () => {
    expect(sanctionDefaultDuration(1)).toBe("7 days");
    expect(sanctionDefaultDuration(2)).toBe("90 days");
    expect(sanctionDefaultDuration(0)).toBeNull();
    expect(sanctionDefaultDuration(3)).toBeNull();
    expect(sanctionDefaultDuration(4)).toBeNull();
  });
});

describe("SLA clock", () => {
  const now = new Date("2026-10-23T12:00:00Z").getTime();

  it("reports remaining time before the deadline", () => {
    const info = slaInfo("2026-10-24T12:00:00Z", now);
    expect(info?.breached).toBe(false);
    expect(info?.label).toContain("1d 0h");
  });

  it("reports a breach after it", () => {
    const info = slaInfo("2026-10-23T10:00:00Z", now);
    expect(info?.breached).toBe(true);
    expect(info?.label).toContain("breached");
  });

  it("is null without a deadline", () => {
    expect(slaInfo(null, now)).toBeNull();
  });
});

describe("formatting helpers", () => {
  it("formats sats as full-precision BTC and grouped sats", () => {
    expect(formatBtcFromSats(1000)).toBe("0.00001000");
    expect(formatBtcFromSats(100_000_000)).toBe("1.00000000");
    expect(formatSats(1234567)).toBe("1,234,567 sats");
  });

  it("falls back to a short trader label without a nickname", () => {
    expect(traderDisplayName("ZedTrader", "abcdef1234")).toBe("ZedTrader");
    expect(traderDisplayName(null, "abcdef1234")).toBe("Trader abcdef");
    expect(traderDisplayName("  ", "abcdef1234")).toBe("Trader abcdef");
  });

  it("completion summary handles the empty record", () => {
    expect(
      completionSummary({ trades_completed: 0, orders_cancelled_unpaid: 0, orders_expired_unpaid: 0 }),
    ).toBe("No trades yet");
    expect(
      completionSummary({ trades_completed: 9, orders_cancelled_unpaid: 1, orders_expired_unpaid: 0 }),
    ).toBe("90% completion · 9 trades");
  });
});

describe("dispute receipt HTML (§4.3 amendment)", () => {
  const base = {
    orderId: "12345678-1234-1234-1234-1234567890ab",
    statusLabel: "Trade completed",
    asset: "BTC",
    cryptoAmountBtc: "0.00050000",
    fiatAmountZmw: 1000,
    priceZmw: 2_000_000,
    feeSats: 250,
    buyerName: "Chanda Mwila",
    sellerName: "Mutinta Banda",
    paymentMethodLine: "Mobile Money · 0977123456 · Mutinta Banda",
    railReference: "MP123456",
    createdAt: "2026-10-23T10:00:00Z",
    paidMarkedAt: "2026-10-23T10:20:00Z",
    completedAt: "2026-10-23T10:35:00Z",
    dispute: null,
    generatedAt: "2026-10-23T12:00:00Z",
  };

  it("renders the order, parties, amounts and reference", () => {
    const html = buildP2pReceiptHtml(base);
    expect(html).toContain("BMaGlass Pay");
    expect(html).toContain("P2P Trade Receipt");
    expect(html).toContain("0.00050000 BTC");
    expect(html).toContain("Chanda Mwila");
    expect(html).toContain("Mutinta Banda");
    expect(html).toContain("MP123456");
    expect(html).toContain("250 sats");
  });

  it("escapes user-controlled strings — data is never markup", () => {
    const html = buildP2pReceiptHtml({
      ...base,
      buyerName: '<script>alert("x")</script>',
      railReference: '"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml(`a & "b" <c> 'd'`)).toBe("a &amp; &quot;b&quot; &lt;c&gt; &#39;d&#39;");
  });

  it("includes the dispute block when the trade was disputed", () => {
    const html = buildP2pReceiptHtml({
      ...base,
      dispute: {
        reasonLabel: "Paid but not received",
        statusLabel: "Ruled — released to buyer",
        rulingNotes: "Ruled on the MTN statement entry ref MP123456.",
        ruledAt: "2026-10-23T11:00:00Z",
      },
    });
    expect(html).toContain("Dispute outcome");
    expect(html).toContain("Ruled — released to buyer");
    expect(html).toContain("MTN statement entry");
  });
});
