// Interpretation of the btc-onchain `send` action's response.
//
// btc-onchain has TWO successful response shapes:
//   200 { txid, fee_sats, status: "broadcast", ... } — the withdrawal
//       was broadcast and finalised.
//   202 { error, txid, status: "verifying" } — the signed transaction
//       was sent to the network but the broadcast outcome is ambiguous,
//       so the withdrawal row stays 'reserved' server-side (no refund,
//       no retry possible) while a human reconciles it. There is NO
//       fee_sats in this shape: the fee is not yet known.
//
// supabase.functions.invoke treats 202 as success, so callers receive
// the verifying body as ordinary `data`. Before this helper existed,
// the wallet treated any 2xx as a broadcast: it read fee_sats
// (undefined) into the result state, producing a "Fee: NaN sats"
// toast and a render crash on fee_sats.toLocaleString() — and the
// server's "do not retry" message was never shown. Every caller must
// route the response through this interpreter instead.

export type OnchainSendOutcome =
  | { kind: "broadcast"; txid: string; feeSats: number }
  | { kind: "verifying"; txid: string | null; message: string }
  | { kind: "unexpected" };

/** Shown when a verifying response carries no message of its own. */
export const BTC_SEND_VERIFYING_FALLBACK_MESSAGE =
  "Your withdrawal was sent to the network but its confirmation is delayed — it is being verified, do not retry.";

export function interpretOnchainSendResponse(data: unknown): OnchainSendOutcome {
  const d = (data ?? {}) as Record<string, unknown>;

  if (d.status === "verifying") {
    return {
      kind: "verifying",
      txid: typeof d.txid === "string" && d.txid ? d.txid : null,
      message:
        typeof d.error === "string" && d.error
          ? d.error
          : BTC_SEND_VERIFYING_FALLBACK_MESSAGE,
    };
  }

  if (
    typeof d.txid === "string" &&
    d.txid &&
    typeof d.fee_sats === "number" &&
    Number.isFinite(d.fee_sats)
  ) {
    return { kind: "broadcast", txid: d.txid, feeSats: d.fee_sats };
  }

  return { kind: "unexpected" };
}
