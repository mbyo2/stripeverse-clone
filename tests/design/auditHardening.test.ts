/**
 * Audit-trail hardening pins (2026-11-11): B1 + B3.
 *
 * B1 — reward_transactions: the admin ALL policy is replaced by a
 * SELECT-only policy; reward issuance (award_transaction_points,
 * SECURITY DEFINER trigger) is untouched.
 * B3 — momo-settings writes redacted connection-lifecycle audit rows:
 * merchant id, event, environment, last-4 hint only. Key material,
 * ciphertext and IV must never reach an audit payload.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('B1 · reward_transactions admin policy narrowed to SELECT', () => {
  const migration = read('supabase/migrations/20261262_reward_transactions_admin_readonly.sql');

  it('drops the ALL policy and creates a SELECT-only admin policy', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "System can manage reward transactions" ON public.reward_transactions');
    expect(migration).toContain('"Admins can view reward transactions" ON public.reward_transactions');
    expect(migration).toContain('FOR SELECT TO public');
    expect(migration).toContain("has_role(auth.uid(), 'admin'::app_role)");
    expect(migration).not.toMatch(/CREATE POLICY[^;]*ON public\.reward_transactions[^;]*FOR (ALL|INSERT|UPDATE|DELETE)/);
  });

  it('does not alter any function (issuance path untouched)', () => {
    expect(migration).not.toMatch(/(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+)?FUNCTION/i);
  });
});

describe('B3 · momo-settings redacted connection audit', () => {
  const src = read('supabase/functions/momo-settings/index.ts');

  it('logs connect, rotate and disconnect events to audit_logs', () => {
    expect(src).toContain('momo_connection_connected');
    expect(src).toContain('momo_connection_rotated');
    expect(src).toContain('momo_connection_disconnected');
    expect(src).toContain('logMomoConnectionEvent');
  });

  it('audit payload carries only environment + key hint — never key material', () => {
    const fnStart = src.indexOf('async function logMomoConnectionEvent');
    const fnBody = src.slice(fnStart, src.indexOf('serve(async', fnStart));
    expect(fnBody).toContain('new_values: { environment, key_hint: keyHint }');
    expect(fnBody).not.toContain('ciphertext');
    expect(fnBody).not.toContain('secret_key');
    expect(fnBody).not.toContain('secretKey');
    expect(fnBody).not.toContain('_iv');
  });
});
