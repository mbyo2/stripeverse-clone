// Rendered-check defect fixes (2026-11-04) — pins for the six defects
// found by the fresh self-custody rendered pass on the live site:
//  1. The unified Spark send showed the RAW SDK error
//     "SparkSdkError: Self payment not allowed". Every Spark SDK
//     failure now goes through toSparkUserFacingError (spark.ts), the
//     self-payment and insufficient-balance cases are pre-checked, and
//     parse/prepare/confirm failures render inline in the panel.
//  2. The Spark confirmation-speed selector wired in 4e4b469 only
//     rendered after Prepare, for bitcoinAddress payments only —
//     invisible in the unified path before that step. It now renders
//     from one helper at BOTH the parse step (Bitcoin destinations)
//     and the confirmation step, and Prepare no longer resets it.
//  3. The on-chain "Review send" could stall on "Preparing…" and
//     silently revert. Balance refusals now happen before the fee
//     fetch, and every prepare outcome leaves either the review step
//     or a persistent inline message in the card.
//  4. The Spark card intro claimed "in one balance" while the page
//     presents two pots. The copy now says two pots, and the spark.ts
//     header no longer claims one balance either.
//  5. The Spark pot showed "—" until a manual Connect. An effect now
//     auto-connects once per unlock.
//  6. "Lock quote & create sell" stayed enabled at zero balance. It
//     is now disabled in that state, with the reason in the panel.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  toSparkUserFacingError,
  sparkSendExceedsBalance,
  isSelfSparkAddress,
  SPARK_SELF_PAYMENT_MESSAGE,
  SPARK_INSUFFICIENT_BALANCE_MESSAGE,
} from "../../src/lib/selfcustody/spark";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const page = read("../../src/pages/SelfCustodyWallet.tsx");
const spark = read("../../src/lib/selfcustody/spark.ts");

const FALLBACK = "Payment failed — nothing was sent. Check the destination and your balance, then try again.";

describe("defect 1 — raw Spark SDK errors can never reach the UI", () => {
  it("maps the exact rendered-check failure to the self-payment message", () => {
    const shown = toSparkUserFacingError(new Error("SparkSdkError: Self payment not allowed"), FALLBACK);
    expect(shown).toBe(SPARK_SELF_PAYMENT_MESSAGE);
    expect(shown).toContain("You can't send to your own wallet");
    expect(shown).not.toContain("SparkSdkError");
  });

  it("maps object-shaped SDK errors the same way", () => {
    const shown = toSparkUserFacingError({ message: "SparkSdkError: Self payment not allowed" }, FALLBACK);
    expect(shown).toBe(SPARK_SELF_PAYMENT_MESSAGE);
  });

  it("maps insufficient-balance SDK errors to a clean refusal", () => {
    for (const raw of [
      "SparkSdkError: Insufficient balance",
      "insufficient funds for this payment",
      "Not enough balance to cover amount and fee",
    ]) {
      const shown = toSparkUserFacingError(new Error(raw), FALLBACK);
      expect(shown).toBe(SPARK_INSUFFICIENT_BALANCE_MESSAGE);
      expect(shown).not.toContain("SparkSdkError");
    }
  });

  it("collapses unrecognised SDK/engine dumps to the caller's fallback", () => {
    for (const raw of [
      "SparkSdkError: internal error panicked at src/wallet.rs:812",
      "BreezSdkError: wasm-bindgen import failed",
      "SparkSdkError: UnexpectedVariant { field: 3 }",
    ]) {
      const shown = toSparkUserFacingError(new Error(raw), FALLBACK);
      expect(shown).toBe(FALLBACK);
      expect(shown).not.toMatch(/SdkError|wasm|panicked/i);
    }
  });

  it("maps expired payment requests and unrecognised destinations", () => {
    expect(toSparkUserFacingError(new Error("SparkSdkError: Invoice expired"), FALLBACK)).toContain(
      "has expired",
    );
    expect(toSparkUserFacingError(new Error("Failed to parse input"), FALLBACK)).toContain(
      "could not be recognised",
    );
  });

  it("still delegates ordinary failures to the app-wide mapper", () => {
    expect(toSparkUserFacingError(new Error("Failed to fetch"), FALLBACK)).toContain(
      "couldn't reach BMaGlass Pay",
    );
    expect(toSparkUserFacingError(null, FALLBACK)).toBe(FALLBACK);
    expect(toSparkUserFacingError(new Error(""), FALLBACK)).toBe(FALLBACK);
  });

  it("every Spark failure surface in the page goes through the mapper", () => {
    const surfaces = page.match(/toSparkUserFacingError\(/g) ?? [];
    // connect, claim, receive, parse, prepare, confirm, LNURL withdraw,
    // LNURL auth, MoonPay buy, sell prepare, sell send = at least 11.
    expect(surfaces.length).toBeGreaterThanOrEqual(11);
    // The unified send handlers no longer toast raw-mapped errors.
    const confirm = page.slice(page.indexOf("const doConfirmSend"), page.indexOf("const doLnurlWithdraw"));
    expect(confirm).toContain("setSpSendError(");
    expect(confirm).toContain("toSparkUserFacingError(");
    expect(confirm).not.toContain("toast.error(toUserFacingError");
  });

  it("pre-checks self-payment and balance before attempting", () => {
    const prepare = page.slice(page.indexOf("const doPrepareSend"), page.indexOf("const doConfirmSend"));
    expect(prepare).toContain("isSelfSparkAddress(own.destination, sendParsedText)");
    expect(prepare).toContain("setSpSendError(SPARK_SELF_PAYMENT_MESSAGE)");
    expect(prepare).toContain("sparkSendExceedsBalance(amount, 0, spBalance)");
    const confirm = page.slice(page.indexOf("const doConfirmSend"), page.indexOf("const doLnurlWithdraw"));
    expect(confirm).toContain("sparkSendExceedsBalance(preparedSend.amountSats");
    expect(confirm).toContain("sparkSendExceedsBalance(preparedLnurl.amountSats");
  });

  it("renders send failures inline in the panel, persistently", () => {
    expect(page).toContain("const [spSendError, setSpSendError] = useState<string | null>(null);");
    expect(page).toContain("{spSendError && (");
    expect(page).toContain("setSpSendError(null);");
  });
});

describe("sparkSendExceedsBalance / isSelfSparkAddress — pure helpers", () => {
  it("blocks only when amount + fee exceeds a KNOWN balance", () => {
    expect(sparkSendExceedsBalance(900, 100, 1000)).toBe(false);
    expect(sparkSendExceedsBalance(901, 100, 1000)).toBe(true);
    expect(sparkSendExceedsBalance(1001, 0, 1000)).toBe(true);
    expect(sparkSendExceedsBalance(5000, 0, null)).toBe(false);
    expect(sparkSendExceedsBalance(Number.NaN, 0, 1000)).toBe(false);
  });

  it("recognises the wallet's own Spark address formatting-insensitively", () => {
    expect(isSelfSparkAddress("spark1abc", "spark1abc")).toBe(true);
    expect(isSelfSparkAddress(" spark1ABC ", "spark1abc")).toBe(true);
    expect(isSelfSparkAddress("spark1abc", "spark1xyz")).toBe(false);
    expect(isSelfSparkAddress(null, "spark1abc")).toBe(false);
    expect(isSelfSparkAddress("spark1abc", "")).toBe(false);
  });
});

describe("defect 2 — Spark speed selector visible in the unified path", () => {
  it("renders from one helper at BOTH the parse step and the confirmation step", () => {
    const calls = page.match(/renderSparkSpeedSelector\(\)/g) ?? [];
    expect(calls.length).toBe(2);
    expect(page).toContain('parsedInput.type === "bitcoinAddress" || parsedInput.type === "bip21"');
    expect(page).toContain('preparedSend.prepareResponse.paymentMethod.type === "bitcoinAddress"');
  });

  it("Prepare no longer resets the chosen speed back to medium", () => {
    expect(page).not.toContain('setSparkSpeed("medium")');
    const prepare = page.slice(page.indexOf("const doPrepareSend"), page.indexOf("const doConfirmSend"));
    expect(prepare).not.toContain("setSparkSpeed(");
  });

  it("the chosen speed still reaches the send itself", () => {
    expect(page).toContain("sparkSendPrepared(session.mnemonic, preparedSend, sparkSpeed)");
    expect(page).toContain('aria-label="Confirmation speed"');
    expect(page).toContain("Confirmation speed for this on-chain send");
  });
});

describe("defect 3 — on-chain Review always resolves", () => {
  it("refuses empty / oversized sends BEFORE the fee fetch", () => {
    const prepare = page.slice(page.indexOf("const doPrepareChainSend"), page.indexOf("const doConfirmChainSend"));
    const preCheck = prepare.indexOf("more than this pot holds");
    const feeFetch = prepare.indexOf("fetchRecommendedFeeRates()");
    expect(preCheck).toBeGreaterThan(-1);
    expect(feeFetch).toBeGreaterThan(preCheck);
    expect(prepare).toContain("Your on-chain balance is 0 sats");
  });

  it("every prepare outcome leaves the review step or a persistent inline message", () => {
    const prepare = page.slice(page.indexOf("const doPrepareChainSend"), page.indexOf("const doConfirmChainSend"));
    expect(prepare).toContain("setChainSendError(msg)");
    expect(page).toContain("const [chainSendError, setChainSendError] = useState<string | null>(null);");
    expect(page).toContain("{chainSendError && !preparedChainSend && (");
    expect(page).toContain('role="alert"');
  });
});

describe("defect 4 — two pots, truthfully described", () => {
  it("the Spark card intro no longer claims one balance", () => {
    expect(page).not.toContain("in one balance");
    expect(page).toContain("The balance here is a second pot, separate from the on-chain pot above.");
  });

  it("the spark.ts header no longer claims one balance either", () => {
    expect(spark).not.toContain("One wallet, one balance");
    expect(spark).toContain("TWO");
    expect(spark).toContain("balances");
  });
});

describe("defect 5 — Spark auto-connects on unlock/load", () => {
  it("has a once-per-unlock auto-connect effect", () => {
    expect(page).toContain("Auto-connect on unlock/load");
    expect(page).toContain("sparkAutoConnectRef.current === session.mnemonic");
    const effect = page.slice(page.indexOf("Auto-connect on unlock/load"), page.indexOf("Automatic Claims settings"));
    expect(effect).toContain('stage !== "wallet"');
    expect(effect).toContain("void refreshSpark();");
  });

  it("resets the auto-connect bookkeeping when the wallet locks", () => {
    const lockReset = page.slice(page.indexOf("disconnectSparkAndWipeStorage();"), page.indexOf('if (stage === "wallet")'));
    expect(lockReset).toContain("sparkAutoConnectRef.current = null;");
  });
});

describe("defect 6 — sell disabled at zero balance, with the reason shown", () => {
  it("computes the guard from BOTH pots and wires it to the button", () => {
    expect(page).toContain("const sellWalletBalanceSats = (scan?.balanceSats ?? 0) + (spBalance ?? 0);");
    expect(page).toContain("sellBlockedByZeroBalance = sellPreview !== null && scan !== null");
    expect(page).toContain("disabled={sellBusy || sellBlockedByZeroBalance}");
  });

  it("states the reason in the panel and guards the handler too", () => {
    expect(page).toContain("Your wallet balance is 0 sats, so there is nothing to sell yet.");
    expect(page).toContain("{sellBlockedByZeroBalance && (");
    const create = page.slice(page.indexOf("const doCreateSell"), page.indexOf("const sellDestination"));
    expect(create).toContain("if (sellBlockedByZeroBalance)");
  });
});
