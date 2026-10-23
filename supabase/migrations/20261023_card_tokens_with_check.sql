-- =====================================================================
-- 20261023_card_tokens_with_check.sql — audit P2-9 (card_tokens leg).
--
-- The table's only policy, "Users manage own card tokens", was FOR ALL
-- with USING (auth.uid() = user_id) and WITH CHECK NULL. For INSERT,
-- Postgres applies WITH CHECK only — a missing WITH CHECK meant a
-- signed-in user could insert card_tokens rows under ANOTHER user's
-- id. The table is empty (count verified 2026-10-23) and is used by
-- the saved-cards hook for the owner's own rows. Recreate the policy
-- with the matching WITH CHECK. Applied live 2026-10-23.
-- =====================================================================

DROP POLICY IF EXISTS "Users manage own card tokens" ON public.card_tokens;
CREATE POLICY "Users manage own card tokens" ON public.card_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
