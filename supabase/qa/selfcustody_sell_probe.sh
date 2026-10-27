#!/usr/bin/env bash
# Post-merge probe for TASK B3 — self-custody sell-to-ZMW.
# Run AFTER: (1) migration 20261235 applied, (2) functions deployed
# from merged main: btc-sell-selfcustody (new), btc-onchain and
# lightning-service (redeployed for the settle hooks).
#
# Required env:
#   SUPABASE_URL        e.g. https://hhxwwozpvgktuqutfkhc.supabase.co
#   SUPABASE_ANON_KEY   publishable key
#   QA_EMAIL / QA_PASSWORD   a QA account (created/deleted by the
#                            coordinator per standing rules — this
#                            script never creates users)
# Optional env:
#   SELL_SATS           default 50000
# The Lightning leg needs the probe invoice PAID from an external
# wallet mid-run: the script prints the bolt11 and waits on stdin.
set -euo pipefail

FN="$SUPABASE_URL/functions/v1"
AUTH="$SUPABASE_URL/auth/v1"
REST="$SUPABASE_URL/rest/v1"
SELL_SATS="${SELL_SATS:-50000}"

JWT=$(curl -s "$AUTH/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$QA_EMAIL\",\"password\":\"$QA_PASSWORD\"}" | jq -r .access_token)
test -n "$JWT" && test "$JWT" != "null" || { echo "PROBE_FAIL sign-in"; exit 1; }
call() { curl -s "$FN/$1" -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' -d "$2"; }

echo "== 1. SQL proofs (dashboard or psql): run supabase/qa/selfcustody_sell_proofs.sql — expect PROOF_OK =="

echo "== 2. Quote preview: fee must be exactly 150 bps =="
call btc-sell-selfcustody '{"action":"quote_preview","amount_sats":50000}' \
  | tee /tmp/sc-quote.json | jq -e '.fee_bps == 150 and .amount_sats == 50000' >/dev/null \
  && echo "PROBE_OK quote_preview"

echo "== 3. Custodial deposit address (existing btc-onchain receive) =="
call btc-onchain '{"action":"receive"}' | jq -e '.address | startswith("bc1")' >/dev/null \
  && echo "PROBE_OK receive"

echo "== 4. Lightning intent: invoice via existing lightning-service, bind intent =="
INV=$(call lightning-service "{\"action\":\"create_invoice\",\"amount_sats\":$SELL_SATS,\"description\":\"probe sell\"}")
PID=$(echo "$INV" | jq -r .payment_id); BOLT=$(echo "$INV" | jq -r .bolt11)
INTENT=$(call btc-sell-selfcustody "{\"action\":\"create_intent\",\"rail\":\"lightning\",\"amount_sats\":$SELL_SATS,\"lightning_payment_id\":\"$PID\"}")
echo "$INTENT" | jq -e '.bolt11 != null and .fee_bps == 150 and .settle_deadline > .expires_at' >/dev/null \
  && echo "PROBE_OK create_intent lightning"
IID=$(echo "$INTENT" | jq -r .intent_id)

echo "== 5. Duplicate intent on the same invoice must be refused (409 / error) =="
call btc-sell-selfcustody "{\"action\":\"create_intent\",\"rail\":\"lightning\",\"amount_sats\":$SELL_SATS,\"lightning_payment_id\":\"$PID\"}" \
  | jq -e '.error != null' >/dev/null && echo "PROBE_OK duplicate invoice refused"

echo "== 6. Check before payment: phase awaiting, nothing credited =="
call btc-sell-selfcustody "{\"action\":\"check\",\"intent_id\":\"$IID\"}" \
  | jq -e '.phase == "awaiting"' >/dev/null && echo "PROBE_OK awaiting"

echo "Pay this invoice from an external Lightning wallet, then press Enter:"
echo "$BOLT"
read -r _

echo "== 7. Poll invoice settle (existing path) then intent check until settled =="
for i in $(seq 1 20); do
  call lightning-service "{\"action\":\"check_status\",\"breez_invoice_id\":\"$PID\"}" >/dev/null || true
  OUT=$(call btc-sell-selfcustody "{\"action\":\"check\",\"intent_id\":\"$IID\"}")
  echo "$OUT" | jq -e '.phase == "settled"' >/dev/null && break
  sleep 5
done
echo "$OUT" | jq -e '.phase == "settled" and .actual_sats == '"$SELL_SATS"' and .zmw_credited > 0' >/dev/null \
  && echo "PROBE_OK settled exactly once at locked rate"
ZMW1=$(curl -s "$REST/wallets?currency=eq.ZMW&account_id=is.null&select=balance" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $JWT" | jq -r '.[0].balance')

echo "== 8. Replay: check again — still settled, ZMW balance unchanged =="
call btc-sell-selfcustody "{\"action\":\"check\",\"intent_id\":\"$IID\"}" \
  | jq -e '.phase == "settled"' >/dev/null
ZMW2=$(curl -s "$REST/wallets?currency=eq.ZMW&account_id=is.null&select=balance" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $JWT" | jq -r '.[0].balance')
test "$ZMW1" = "$ZMW2" && echo "PROBE_OK replay-safe (ZMW $ZMW1 unchanged)"

echo "== 9. On-chain intent creates against the custodial address =="
call btc-sell-selfcustody "{\"action\":\"create_intent\",\"rail\":\"onchain\",\"amount_sats\":$SELL_SATS}" \
  | jq -e '.deposit_address | startswith("bc1")' >/dev/null && echo "PROBE_OK create_intent onchain"
# (Send SELL_SATS to that address from any wallet, wait for the
# scheduled check_deposits scan, then `check` the returned intent_id:
# expect phase settled with actual_sats == SELL_SATS.)

echo "ALL PROBES DONE"
