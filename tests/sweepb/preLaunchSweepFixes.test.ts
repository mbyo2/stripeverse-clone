// Pre-launch completion sweep 2026-11-05 — pins for the defects found
// by the live QA pass + the two static child sweeps. Each pin names
// the behaviour a real user depends on; if a future change reverts
// one, these fail loudly instead of the defect shipping silently.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");

describe("Dashboard truthfulness", () => {
  const src = read("src/pages/Dashboard.tsx");
  it("no longer promises Buy/Withdraw chips to everyone", () => {
    expect(src).not.toContain('["Deposit", "Buy", "Sell", "Withdraw"]');
    expect(src).toContain('canSeeFeature("custodialSend")');
    expect(src).toContain('"Deposit", "Sell"');
  });
  it("Request quick action goes to the request-money page", () => {
    expect(src).toContain("navigate('/request-money')");
  });
});

describe("UserDashboard", () => {
  it("no 'Upgrade' badge advertising a nonexistent upgrade path", () => {
    const src = read("src/pages/UserDashboard.tsx");
    expect(src).not.toContain("Upgrade");
  });
});

describe("Transfer self-guard uses the user's own phone", () => {
  it("Transfer.tsx passes the profile phone, never a hardcoded number", () => {
    const src = read("src/pages/Transfer.tsx");
    expect(src).not.toContain("+260971234567");
    expect(src).toContain("profile?.phone");
  });
  it("validateWalletTransfer skips the check when the sender phone is unknown", () => {
    const src = read("src/lib/utils.ts");
    expect(src).toContain("senderPhone && (senderPhone === receiverPhone");
  });
});

describe("PublicCheckout guest surfaces", () => {
  const src = read("src/pages/PublicCheckout.tsx");
  it("describe failures pass through the error mapper", () => {
    expect(src).toContain("setError(toUserFacingError(failure, 'Payment link not found or expired'))");
  });
  it("load-error state offers a retry", () => {
    expect(src).toContain("window.location.reload()");
  });
  it("an empty method set renders an explanation, not an empty grid", () => {
    expect(src).toContain("No way to pay is available for this link right now.");
    expect(src).toContain("methods.length === 0");
  });
  it("success without a store redirect still offers a way onward", () => {
    expect(src).toContain("Go to BMaGlass Pay");
  });
  it("signed-in payers get their receipt email prefilled", () => {
    expect(src).toContain("data.session?.user.email");
  });
});

describe("Dead-end removals", () => {
  it("VirtualCardFund shows an error state instead of an infinite skeleton", () => {
    const src = read("src/pages/VirtualCardFund.tsx");
    expect(src).toContain("cardError");
    expect(src).toContain("We couldn't load this card.");
    expect(src).not.toContain("if (cardLoading || !card)");
  });
  it("PaymentLinks distinguishes a load failure from an empty list", () => {
    const src = read("src/pages/PaymentLinks.tsx");
    expect(src).toContain("linksError");
    expect(src).toContain("We couldn't load your payment links. Please try again.");
  });
  it("P2P marketplace empty state offers the Post an Ad action", () => {
    const src = read("src/pages/P2PMarketplace.tsx");
    expect(src).toContain('action={paused ? undefined : { label: "Post an Ad"');
  });
  it("BitcoinWallet send result panels have a Done button that closes the dialog", () => {
    const src = read("src/pages/BitcoinWallet.tsx");
    expect(src).toContain("onClose={() => setSendOpen(false)}");
    expect(src.match(/setResult\(null\); onClose\?\.\(\);/g)?.length).toBe(4);
  });
});

describe("Verbatim server-message guards on send outcomes", () => {
  it("btcSend interpreter maps server strings through toUserFacingError", () => {
    const src = read("src/utils/btcSend.ts");
    expect(src).toContain("toUserFacingError(d.message, BTC_SEND_AWAITING_FALLBACK_MESSAGE)");
    expect(src).toContain("toUserFacingError(d.error, BTC_SEND_VERIFYING_FALLBACK_MESSAGE)");
  });
  it("LightningSend and LnurlSend map failed/awaiting server strings", () => {
    for (const f of ["src/components/bitcoin/LightningSend.tsx", "src/components/bitcoin/LnurlSend.tsx"]) {
      const src = read(f);
      expect(src).toContain("toUserFacingError(data.error, \"This payment didn't go through. Nothing was sent.\")");
      expect(src).toContain("toUserFacingError(data.message, \"Your payment is being prepared");
    }
  });
  it("BitcoinWallet queue path maps the server message", () => {
    const src = read("src/pages/BitcoinWallet.tsx");
    expect(src).toContain("toUserFacingError(data.message, \"Your payment is being prepared");
  });
});

describe("Copy + policy alignment", () => {
  it("self-custody no longer points at a nonexistent custodial Receive tab", () => {
    const src = read("src/pages/SelfCustodyWallet.tsx");
    expect(src).not.toContain("custodial wallet's Receive tab");
    expect(src).toContain("tap Deposit BTC");
  });
  it("identity verification offers NRC + Passport only", () => {
    const src = read("src/pages/VerifyIdentity.tsx");
    expect(src).not.toContain("driver_licence");
    expect(src).toContain("National ID (NRC)");
    expect(src).toContain("Passport");
  });
  it("btc-onchain activity rows carry metadata.sats like every other BTC writer", () => {
    const src = read("supabase/functions/btc-onchain/index.ts");
    expect(src).toContain("sats: amountSats + effectiveFeeSats");
  });
});
