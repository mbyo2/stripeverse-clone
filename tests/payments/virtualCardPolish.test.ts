// Source pins for the virtual-card polish batch. The edge functions
// run on Deno and cannot be executed by vitest, so — the repo's
// established pattern — these tests pin the security-relevant wiring
// in the sources.
//
//   FIX 1  fund-virtual-card debits the card's OWN bound wallet
//          (virtual_cards.wallet_id), resolved by id — never
//          `.single()` on user_id alone, which throws for anyone
//          holding more than one wallet. Legacy cards with a NULL
//          wallet_id fall back to the caller's Main ZMW wallet
//          (user_id + currency 'ZMW' + account_id IS NULL).
//   FIX 2  VirtualCardNew shows the one-time creation reveal
//          (full number, CVV, expiry — returned once by
//          create-virtual-card and never stored) in a dedicated
//          panel with copy buttons and the save-now warning,
//          instead of discarding the response and navigating away.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");

const fundFn = read("../../supabase/functions/fund-virtual-card/index.ts");
const cardNew = read("../../src/pages/VirtualCardNew.tsx");

/** Slice of `src` between two markers (exclusive), for ordering pins. */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a + start.length);
  expect(a, `marker not found: ${start}`).toBeGreaterThanOrEqual(0);
  expect(b, `marker not found: ${end}`).toBeGreaterThan(a);
  return src.slice(a + start.length, b);
}

describe("FIX 1 — fund-virtual-card debits the card's bound wallet", () => {
  it("never resolves a wallet with .single() on user_id alone", () => {
    // The exact pre-fix wallet lookup is gone entirely.
    expect(fundFn).not.toMatch(
      /from\('wallets'\)\s*\.select\('\*'\)\s*\.eq\('user_id', user\.id\)\s*\.single\(\)/,
    );
    // No wallet update is scoped by user_id anymore either — the
    // debit and its rollback target the one resolved wallet row.
    expect(fundFn).not.toMatch(/from\('wallets'\)\s*\.update\([\s\S]{0,160}?\.eq\('user_id', user\.id\)/);
  });

  it("loads the card first and resolves the wallet from card.wallet_id", () => {
    const cardLoadIdx = fundFn.indexOf(".from('virtual_cards')");
    const boundIdx = fundFn.indexOf(".eq('id', card.wallet_id)");
    expect(cardLoadIdx).toBeGreaterThanOrEqual(0);
    expect(boundIdx).toBeGreaterThan(cardLoadIdx);
    expect(fundFn).toContain("if (card.wallet_id) {");
  });

  it("verifies the bound wallet belongs to the caller and is active", () => {
    expect(fundFn).toContain("boundWallet.user_id === user.id");
    expect(fundFn).toContain('wallet.status !== "active"');
    expect(fundFn).toContain('throw new Error("Wallet is not active")');
    // Ownership/balance checks happen before any debit.
    const balanceIdx = fundFn.indexOf("wallet.balance < totalDebit");
    const debitIdx = fundFn.indexOf("balance: wallet.balance - totalDebit");
    expect(balanceIdx).toBeGreaterThanOrEqual(0);
    expect(debitIdx).toBeGreaterThan(balanceIdx);
  });

  it("legacy NULL wallet_id falls back to the caller's Main ZMW wallet", () => {
    const fallback = between(fundFn, "} else {", "wallet = mainWallet ?? null;");
    expect(fallback).toContain(".from('wallets')");
    expect(fallback).toContain(".eq('user_id', user.id)");
    expect(fallback).toContain(".eq('currency', 'ZMW')");
    expect(fallback).toContain(".is('account_id', null)");
    expect(fallback).toContain(".maybeSingle()");
  });

  it("debit and rollback both target the resolved wallet by id", () => {
    const byId = fundFn.split(".eq('id', wallet.id)").length - 1;
    expect(byId).toBe(2); // debit + rollback
  });

  it("keeps the funding economics and response shape unchanged", () => {
    expect(fundFn).toContain("Math.max(amount * 0.01, 2)");
    expect(fundFn).toContain("transaction_type: 'card_funding'");
    expect(fundFn).toContain("newCardBalance: card.balance + amount");
    expect(fundFn).toContain("newWalletBalance: wallet.balance - totalDebit");
  });
});

describe("FIX 2 — VirtualCardNew shows the one-time reveal instead of discarding it", () => {
  it("captures the one-time fields from the creation response", () => {
    expect(cardNew).toContain("cardNumber: data.card.card_number,");
    expect(cardNew).toContain("cvv: data.card.cvv,");
    expect(cardNew).toContain("data.card.expiry");
    expect(cardNew).toContain("data.card.expiry_date");
    expect(cardNew).toContain("setCreatedCard(reveal)");
  });

  it("keeps the reveal even if funding fails after creation", () => {
    const submit = between(cardNew, "const handleSubmit", '// Virtual cards are "Coming soon"');
    const successIdx = submit.indexOf("setCreatedCard(reveal);");
    const catchIdx = submit.indexOf("if (reveal) setCreatedCard(reveal);");
    expect(successIdx).toBeGreaterThanOrEqual(0);
    expect(catchIdx).toBeGreaterThan(successIdx);
  });

  it("renders the full number, CVV and expiry in the reveal panel", () => {
    const panel = between(cardNew, "{createdCard && (", "{!createdCard && (");
    expect(panel).toContain("formatCardNumber(createdCard.cardNumber)");
    expect(panel).toContain("createdCard.cvv");
    expect(panel).toContain("createdCard.expiry");
    expect(panel).toContain("Your New Card Details");
  });

  it("carries the save-now warning verbatim", () => {
    expect(cardNew).toContain(
      "Save these now — for your security they are not stored and cannot be shown again.",
    );
  });

  it("offers copy-to-clipboard for each revealed secret", () => {
    expect(cardNew).toContain("navigator.clipboard.writeText");
    for (const field of ['"cardNumber"', '"cvv"', '"expiry"']) {
      expect(cardNew).toContain(`copyToClipboard(${field},`);
    }
    expect(cardNew).toContain('aria-label="Copy card number"');
    expect(cardNew).toContain('aria-label="Copy CVV"');
    expect(cardNew).toContain('aria-label="Copy expiry"');
  });

  it("persists the secrets nowhere — component state only", () => {
    // No storage API is ever called with (or for) the secrets — the
    // reveal lives in useState and dies with the page. (The page's
    // own comment mentions localStorage in prose to say exactly
    // that, so the pin targets actual API calls.)
    expect(cardNew).not.toMatch(/localStorage\s*\.\s*(setItem|getItem|removeItem)\s*\(/);
    expect(cardNew).not.toMatch(/sessionStorage\s*\.\s*(setItem|getItem|removeItem)\s*\(/);
    expect(cardNew).not.toContain("document.cookie");
    // The secrets never enter the URL either: the only navigation
    // carries the card id, as before.
    expect(cardNew).toContain("navigate(`/card/${createdCard.id}`)");
    expect(cardNew).not.toMatch(/navigate\(`[^`]*\$\{createdCard\.(cardNumber|cvv|expiry)/);
  });

  it("shows the creation form only until a card is created", () => {
    expect(cardNew).toContain("{!createdCard && (");
  });
});
