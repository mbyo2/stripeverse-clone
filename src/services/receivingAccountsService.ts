// Local receiving accounts — data layer.
//
// All writes go through the SECURITY DEFINER RPCs in migration
// 20261246 (request_receiving_account + admin_* functions). The
// tables have SELECT-only grants for authenticated users, so there
// is deliberately no client insert/update path here. The new tables
// are not in the generated types yet, hence the scoped `as any`
// casts (same pattern as useMoonpay's platform_settings read).

import { supabase } from "@/integrations/supabase/client";
import type {
  ReceivingAccount,
  ReceivingDeposit,
  ReceivingPartner,
} from "@/utils/receivingAccounts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function fetchReceivingAccountsEnabled(): Promise<boolean> {
  const { data, error } = await db
    .from("platform_settings")
    .select("receiving_accounts_enabled")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return false;
  return data.receiving_accounts_enabled === true;
}

export async function fetchMyReceivingAccounts(
  userId: string,
): Promise<ReceivingAccount[]> {
  const { data, error } = await db
    .from("receiving_accounts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as ReceivingAccount[];
}

export async function fetchMyReceivingDeposits(
  userId: string,
): Promise<ReceivingDeposit[]> {
  const { data, error } = await db
    .from("receiving_deposits")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as ReceivingDeposit[];
}

export async function fetchLivePartners(): Promise<ReceivingPartner[]> {
  const { data, error } = await db
    .from("receiving_partners")
    .select("*")
    .eq("status", "live")
    .order("name", { ascending: true });
  if (error) return [];
  return (data ?? []) as ReceivingPartner[];
}

export interface RequestReceivingResult {
  outcome: string;
  accountId: string | null;
  accountStatus: string | null;
}

export async function requestReceivingAccount(
  currency: string,
): Promise<RequestReceivingResult> {
  const { data, error } = await db.rpc("request_receiving_account", {
    p_currency: currency,
  });
  if (error) {
    return { outcome: "error", accountId: null, accountStatus: null };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    outcome: row?.outcome ?? "error",
    accountId: row?.account_id ?? null,
    accountStatus: row?.account_status ?? null,
  };
}

export async function fetchAllPartners(): Promise<ReceivingPartner[]> {
  const { data, error } = await db
    .from("receiving_partners")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as ReceivingPartner[];
}

export async function fetchAllReceivingAccounts(): Promise<ReceivingAccount[]> {
  const { data, error } = await db
    .from("receiving_accounts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []) as ReceivingAccount[];
}

export async function fetchRecordedDeposits(): Promise<ReceivingDeposit[]> {
  const { data, error } = await db
    .from("receiving_deposits")
    .select("*")
    .eq("status", "recorded")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return [];
  return (data ?? []) as ReceivingDeposit[];
}

// ---------------------------------------------------------------------
// Admin — all actions go through the receiving-admin edge function,
// which verifies the caller, gates on admin/super_admin, and calls
// the service-role RPCs JWT-free (the house money pattern: wallet
// balance updates are neutralised under a user JWT). The RPCs are
// not callable from the client at all.
// ---------------------------------------------------------------------

interface AdminResult {
  ok: boolean;
  message: string;
  data?: unknown;
  outcome?: string;
}

async function callReceivingAdmin(
  action: string,
  payload: Record<string, unknown>,
  successMessage: string,
): Promise<AdminResult> {
  const { data, error } = await supabase.functions.invoke("receiving-admin", {
    body: { action, ...payload },
  });
  if (error) {
    return {
      ok: false,
      message: "Something went wrong on our side. Please try again.",
    };
  }
  const body = (data ?? {}) as {
    success?: boolean;
    error?: string;
    data?: unknown;
  };
  if (!body.success) {
    return {
      ok: false,
      message:
        typeof body.error === "string" && body.error.length <= 200
          ? body.error
          : "Something went wrong on our side. Please try again.",
    };
  }
  return { ok: true, message: successMessage, data: body.data };
}

export async function adminCreatePartner(input: {
  name: string;
  currencies: string[];
  status: string;
  notes?: string;
}): Promise<{ ok: boolean; message: string }> {
  return callReceivingAdmin(
    "create_partner",
    {
      name: input.name,
      currencies: input.currencies,
      status: input.status,
      notes: input.notes ?? null,
    },
    "Partner saved.",
  );
}

export async function adminUpdatePartner(input: {
  partnerId: string;
  status?: string;
  currencies?: string[];
  notes?: string;
}): Promise<{ ok: boolean; message: string }> {
  return callReceivingAdmin(
    "update_partner",
    {
      partner_id: input.partnerId,
      status: input.status ?? null,
      currencies: input.currencies ?? null,
      notes: input.notes ?? null,
    },
    "Partner updated.",
  );
}

export async function adminAssignAccount(input: {
  accountId: string;
  partnerId: string;
  accountHolderName: string;
  routingNumber?: string;
  accountNumber?: string;
  iban?: string;
  bic?: string;
  sortCode?: string;
}): Promise<{ ok: boolean; message: string }> {
  return callReceivingAdmin(
    "assign_account",
    {
      account_id: input.accountId,
      partner_id: input.partnerId,
      account_holder_name: input.accountHolderName,
      routing_number: input.routingNumber ?? null,
      account_number: input.accountNumber ?? null,
      iban: input.iban ?? null,
      bic: input.bic ?? null,
      sort_code: input.sortCode ?? null,
    },
    "Details assigned.",
  );
}

export async function adminSetAccountStatus(
  accountId: string,
  status: string,
): Promise<{ ok: boolean; message: string }> {
  return callReceivingAdmin(
    "set_account_status",
    { account_id: accountId, status },
    "Account status updated.",
  );
}

export async function adminRecordDeposit(input: {
  accountId: string;
  amount: number;
  senderName?: string;
  senderReference?: string;
}): Promise<{ ok: boolean; message: string }> {
  return callReceivingAdmin(
    "record_deposit",
    {
      account_id: input.accountId,
      amount: input.amount,
      sender_name: input.senderName ?? null,
      sender_reference: input.senderReference ?? null,
    },
    "Deposit recorded — credit it to complete.",
  );
}

export async function adminCreditDeposit(
  depositId: string,
): Promise<{ ok: boolean; message: string; outcome?: string }> {
  const result = await callReceivingAdmin(
    "credit_deposit",
    { deposit_id: depositId },
    "Deposit credited to the user's wallet.",
  );
  if (!result.ok) return result;
  const rows = Array.isArray(result.data) ? result.data : [result.data];
  const outcome = (rows[0] as { outcome?: string } | undefined)?.outcome;
  if (outcome === "already_credited") {
    return {
      ok: true,
      message: "This deposit was already credited — nothing moved twice.",
      outcome,
    };
  }
  if (outcome === "deposit_rejected") {
    return { ok: false, message: "This deposit was rejected and can't be credited.", outcome };
  }
  return { ...result, outcome };
}

export async function adminRejectDeposit(
  depositId: string,
  reason?: string,
): Promise<{ ok: boolean; message: string }> {
  return callReceivingAdmin(
    "reject_deposit",
    { deposit_id: depositId, reason: reason ?? null },
    "Deposit rejected.",
  );
}
