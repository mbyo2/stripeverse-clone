# Bitcoin POS — Data Bridge

**What it is.** A merchant data layer, not a checkout and not a till.
A merchant creates a Bitcoin payment request at the point of sale
(their own till/order reference + a kwacha amount), the customer pays
**on-chain Bitcoin** to the merchant's BMaGlass deposit address, and
the merchant's **existing** POS or accounting system pulls the settled
records back out — JSON API or CSV export — to reconcile the sale and
post the books. BMaGlass supplies the payment data; the merchant's
systems remain their systems.

Shipped in: migration `20261030_bitcoin_pos_data.sql`, edge function
`supabase/functions/pos/`, shared pure logic
`supabase/functions/_shared/pos-core.ts`, merchant page `/pos`
(`src/pages/BitcoinPos.tsx`), proofs `supabase/qa/pos_proofs.sql`.

## How a payment flows

1. Merchant creates a request (page or any signed-in client →
   `pos` function, `create_request`). The function:
   - reads the latest non-stale BTC index from `p2p_price_snapshots`
     (Coinbase/Kraken cross-checked BTC/USD × `exchange_rates`
     USD/ZMW — the same index P2P order creation uses), refusing in
     plain language if the index is stale or missing;
   - converts ZMW → sats at the **raw index, no trade spread**,
     floored (a POS price is the merchant's own price; the platform
     trade spread does not belong in it);
   - gets the merchant's deposit address by calling `btc-onchain`
     `receive` with the merchant's own JWT — the existing issuance
     path, including its honest custody refusals;
   - stores the request with the rate locked on the row
     (`btc_zmw_rate`, `rate_source = 'p2p_price_snapshots'`).
2. The customer scans the BIP21 QR (`bitcoin:<address>?amount=…&label=<reference>`)
   and pays on-chain from any wallet.
3. The existing deposit scanner (`btc-onchain` `check_deposits` →
   `btc_record_deposit`) detects the payment and credits the
   merchant's BTC balance at 1 confirmation, exactly as for any
   deposit. A trigger on `btc_deposits` then annotates the matched
   POS request. Nothing about crediting changes for anyone.
4. The merchant's system polls the API or pulls a CSV and reconciles
   by `merchant_reference`.

## Address model (read this before "fixing" it)

Deposit addresses are **per-user, not per-request**: the custody
design assigns exactly one BIP84 address per user
(`btc_address_assignments.user_id` is UNIQUE). POS inherits that.
Matching is therefore by `(user_id, deposit_address)`:

- candidates: the merchant's requests on that address still
  `awaiting_payment`;
- an **exact-amount** candidate wins; otherwise the **oldest** open
  request (FIFO);
- one deposit settles at most one request; one request is settled by
  at most one deposit in v1 — an underpaid request does **not**
  absorb a second deposit (the merchant raises a new request for the
  remainder). Every match stays explainable from the two tables;
- classification is exact integer comparison: received == expected →
  `paid`, less → `underpaid`, more → `overpaid`;
- a deposit with no open request is just a deposit — POS is
  invisible to it.

The match runs inside `btc_record_deposit`'s transaction but is
wrapped in an exception handler that converts any POS failure into a
`RAISE WARNING`: annotation can never break or delay crediting.

## Machine API (v1)

`POST https://<project>.functions.supabase.co/functions/v1/pos` with
`Authorization: Bearer bmp_pos_<64 hex>`:

| action | body | returns |
| --- | --- | --- |
| `list_requests` | `status?`, `from?`, `to?`, `limit?` (≤200), `offset?` | `{ requests, total, limit, offset }` |
| `get_request_by_reference` | `reference` | `{ request }` or 404 |

Keys are read-only, scoped to their merchant, hashed (SHA-256) at
rest, shown once at creation, revocable from the `/pos` page, and
rate-limited per key (120/min, best-effort per isolate). Merchant UI
actions (create/cancel/keys/CSV) require a user JWT — the same
function dispatches on the credential presented.

CSV export columns (fixed contract):
`date, reference, status, fiat_zmw, sats_expected, sats_received, btc_zmw_rate, txid, confirmations, paid_at`.

## PDF documents

Two designed print documents, built by `src/utils/posStatement.ts`
and printed through the house pattern (`TransactionReceipt`:
standalone HTML in a new window → print → save as PDF):

- **Statement** (Export card, "Export statement (PDF)"): brand
  header, merchant + period, a cream summary band (requests, paid in
  full, collected ZMW — the value of BTC that actually arrived at
  locked rates — BTC received, volume-weighted average rate), the
  itemised table, and a "how to read this statement" note. Page
  furniture (reconciliation note, domain, "Page N of M") lives in
  `@page` margin boxes so it can never collide with content.
- **Receipt** (per request, "Receipt (PDF)"): same design language,
  one request — amount, status pill, full txid and address.

Both are paper artefacts: white background and dark text regardless
of the app's theme. Summary math is canonical in
`pos-core.summarisePosRequests`, mirrored in the statement util and
parity-pinned by the vitest suite. Visually verified 2026-10-23 by
rendering fixture documents (45 requests → 3 pages) to PDF and
inspecting every page: margins, column alignment, repeated table
header, no clipped or overlapping columns, footer on all pages.

## Phase 2 (not built)

- **Webhooks**: signed POST to a merchant URL on request settlement
  (the platform already has webhook plumbing — `dispatch-webhook`,
  `transaction-webhook` — to model it on), with retry + a delivery
  log. Polling + CSV are the v1 contract; do not let a merchant
  depend on push until this lands.
- Per-request addresses, if custody ever moves beyond one address
  per user (matching would become exact by address).
- Multi-deposit settlement of one request (partial payments), if
  merchants actually ask for it.
- Request creation via API key (currently JWT-only, so a key leak
  can never create or cancel requests).
