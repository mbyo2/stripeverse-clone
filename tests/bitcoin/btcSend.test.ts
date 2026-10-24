// Unit tests for interpretOnchainSendResponse (src/utils/btcSend.ts),
// the interpreter for the btc-onchain `send` action's responses.
//
// The case that matters most is the 202 "verifying" shape: when the
// broadcast outcome is ambiguous, btc-onchain answers 202 with
// { error: "…being verified, do not retry", txid, status: "verifying" }
// and NO fee_sats (the withdrawal row stays 'reserved' server-side).
// supabase.functions.invoke treats 202 as success, so before this
// interpreter existed the wallet read fee_sats (undefined) into its
// result state — "Fee: NaN sats" toast plus a render crash on
// fee_sats.toLocaleString() — and the do-not-retry message was lost.

import { describe, it, expect } from "vitest";
import {
  interpretOnchainSendResponse,
  BTC_SEND_VERIFYING_FALLBACK_MESSAGE,
} from "../../src/utils/btcSend";

const VERIFYING_MESSAGE =
  "Your withdrawal was sent to the network but its confirmation is delayed — it is being verified, do not retry";

describe("interpretOnchainSendResponse", () => {
  it("maps the 202 verifying shape to a verifying outcome with the server's message", () => {
    const outcome = interpretOnchainSendResponse({
      error: VERIFYING_MESSAGE,
      txid: "abc123txid",
      withdrawal_id: "wd-1",
      status: "verifying",
    });
    expect(outcome).toEqual({
      kind: "verifying",
      txid: "abc123txid",
      message: VERIFYING_MESSAGE,
    });
  });

  it("never reads fee_sats off a verifying response", () => {
    const outcome = interpretOnchainSendResponse({
      error: VERIFYING_MESSAGE,
      txid: "abc123txid",
      status: "verifying",
      // fee_sats is absent in the real 202 body; the outcome type must
      // not carry a fee at all.
    });
    expect(outcome.kind).toBe("verifying");
    expect(outcome).not.toHaveProperty("feeSats");
    expect(outcome).not.toHaveProperty("fee_sats");
  });

  it("falls back to the plain-language message when a verifying body has none", () => {
    const outcome = interpretOnchainSendResponse({
      txid: "abc123txid",
      status: "verifying",
    });
    expect(outcome).toEqual({
      kind: "verifying",
      txid: "abc123txid",
      message: BTC_SEND_VERIFYING_FALLBACK_MESSAGE,
    });
  });

  it("maps the 200 broadcast shape to a broadcast outcome with its fee", () => {
    const outcome = interpretOnchainSendResponse({
      withdrawal_id: "wd-2",
      txid: "def456txid",
      amount_sats: 50_000,
      fee_sats: 1_234,
      status: "broadcast",
    });
    expect(outcome).toEqual({
      kind: "broadcast",
      txid: "def456txid",
      feeSats: 1_234,
    });
  });

  it("treats a 2xx body missing its fee as unexpected, not as a broadcast", () => {
    expect(
      interpretOnchainSendResponse({ txid: "def456txid", status: "broadcast" }),
    ).toEqual({ kind: "unexpected" });
    expect(
      interpretOnchainSendResponse({
        txid: "def456txid",
        fee_sats: Number.NaN,
        status: "broadcast",
      }),
    ).toEqual({ kind: "unexpected" });
  });

  it("treats empty and null bodies as unexpected", () => {
    expect(interpretOnchainSendResponse(null)).toEqual({ kind: "unexpected" });
    expect(interpretOnchainSendResponse(undefined)).toEqual({
      kind: "unexpected",
    });
    expect(interpretOnchainSendResponse({})).toEqual({ kind: "unexpected" });
  });
});
