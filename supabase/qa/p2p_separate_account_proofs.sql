-- =====================================================================
-- p2p_separate_account_proofs.sql — Binance-style separate P2P account
-- (migration 20261201_p2p_separate_account.sql)
--
-- Executed live 2026-10-24 against project hhxwwozpvgktuqutfkhc
-- (paymentgetway) with QA accounts qa11 (seller), qa17 (buyer),
-- qa12 (smuggle actor), qa13 (admin, freeze toggle). Marketplace
-- stayed PAUSED except seconds-long sanctioned p2p_enabled windows
-- for ad/order creation (closed + SELECT-verified after each use;
-- one window ran ~90s long because a batched flag-off statement
-- rolled back with a bad assert query — closed immediately once
-- seen; only the proof's own calls ran inside it).
--
-- Fixture price index: K10,000,000/BTC ⇒ K100 = 1,000 sats,
-- 0.5% completion fee = 5 sats.
--
-- RESULT SUMMARY (all legs PASS):
--   L0  sell-ad inventory gate reads p2p_wallets (main-rich /
--       p2p-poor seller refused: "This ad is larger than the
--       Bitcoin you currently have available", create_ad line 160)
--   L1  lock draws on p2p_wallets: create_order for a p2p-poor
--       seller fails P0001 Insufficient BTC balance raised inside
--       p2p_adjust_p2p_wallet via p2p_lock_crypto_btc; 0 orders
--   L2  transfers via the p2p edge function (JWT identity):
--       - transfer_to_p2p 50,000: main 50000/50000, p2p 50000/50000
--       - replay of the same idempotency key: replayed=true, same
--         transfer_id, balances identical, exactly 1 ledger row
--       - over-amount 50,001: 400 crafted refusal, no ledger row
--       - cross-user smuggle (qa12's JWT, body naming qa11):
--         refused on the CALLER's own available; qa11 untouched
--   L3  full lifecycle (lock → mark_paid → confirm_release via the
--       edge): order completed, fee_minor 5; seller MAIN wallet
--       byte-identical (50000/50000), seller p2p 49000/49000;
--       buyer MAIN byte-identical (100000/100000), buyer p2p
--       995/995; operator p2p +5; T+1 hold row held:995
--   L4  held sats cannot change pockets: buyer transferable = 0
--       (995 held) → to_main 995 and to_main 1 both refused with
--       the crafted safety-hold message; after +2,000 unheld:
--       to_main 2,001 refused, to_main 2,000 succeeded exactly
--   L5  freeze (qa17 frozen via admin RPC with qa13's admin JWT):
--       edge transfer_to_p2p AND transfer_to_main → 403 with the
--       crafted frozen message; direct RPC call with a fresh key
--       → P0001 same message raised in p2p_account_transfer;
--       balances unchanged; unfrozen afterwards. (Replay of an
--       already-completed key returns the stored receipt even
--       while frozen — no money moves; by design.)
--   L6  transfer while a lock is active: seller p2p 49000/48000
--       (1,000 locked) → transfer_to_main 48,000 exact (p2p
--       1000/0, main 98000/98000); buyer cancel → available back
--       to exactly 1,000
--   L7  p2p_reconcile_escrow() during the lock: drift_sats 0,
--       wallet_gap_sats 1000 = locked_holds_sats 1000,
--       invariant_violations 0, wallet_source 'p2p_wallets';
--       after cancel: drift 0, gap 0, locked 0, violations 0.
--       (open_orders_without_locked_hold = 1 is the known Wave B
--       fixture anomaly d1111111 — pre-existing, out of scope.)
--
-- Cleanup (B5-style) restored every baseline: proof orders /
-- claims / holds / ads / methods / fixture snapshots / proof
-- transfer-ledger rows / fixture KYC+AML rows deleted (immutable
-- chat + audit tables via the disable-trigger → delete → enable
-- pattern, triggers verified tgenabled='O' afterwards; the
-- p2p_account_transfer AUDIT rows remain as the proof trail);
-- p2p_wallets back to 0 rows; qa11 main 97000, qa12 main 102985
-- (never touched), qa17 main 100000; qa16's pre-existing
-- available>balance dirt (0/40000) untouched; flag false.
-- =====================================================================

-- ── Structural spot-checks (post-migration, all PASS) ──────────────
-- The three invariant CHECKs + PK + (user_id, asset) unique exist
-- on public.p2p_wallets; exactly one owner SELECT policy per new
-- table, qual (user_id = ( SELECT auth.uid() AS uid)); proacl =
-- {postgres, service_role} on p2p_account_transfer,
-- p2p_adjust_p2p_wallet and the five re-pointed trade functions.

SELECT conname
  FROM pg_constraint
 WHERE conrelid = 'public.p2p_wallets'::regclass
   AND contype IN ('c', 'u', 'p');
-- EXPECT: balance/available CHECKs, PK, unique(user_id, asset).

SELECT proname, proacl::text
  FROM pg_proc
 WHERE proname IN ('p2p_account_transfer', 'p2p_adjust_p2p_wallet',
                   'p2p_lock_crypto_btc', 'p2p_unlock_crypto_btc',
                   'p2p_release_crypto_btc', 'p2p_create_ad',
                   'p2p_reconcile_escrow')
 ORDER BY proname;
-- EXPECT: proacl {postgres=X/postgres, service_role=X/postgres}.

-- ── Trade path no longer touches the main wallet (PASS) ────────────
-- The ONLY p2p_* function still referencing crypto_wallets is
-- p2p_account_transfer itself — the door between the pockets.
SELECT p.proname
  FROM pg_proc p
 WHERE p.proname LIKE 'p2p\_%'
   AND p.prosrc LIKE '%crypto_wallets%';
-- EXPECT: exactly one row — p2p_account_transfer.

-- Global invariant: impossible by CHECK, asserted anyway.
SELECT COUNT(*) AS invariant_violations
  FROM public.p2p_wallets
 WHERE available_sats > balance_sats
    OR balance_sats < 0 OR available_sats < 0;
-- EXPECT: 0.

-- Reconcile over any state: p2p-side drift must be 0.
SELECT public.p2p_reconcile_escrow();
-- EXPECT: drift_sats 0, wallet_source 'p2p_wallets',
-- invariant_violations 0.
