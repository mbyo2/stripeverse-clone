// invoice-checkout: settlement entry point for invoices and payment
// requests (Final-QA FIX-2).
//
// Before this function existed, an invoice's payment_link_code and a
// payment request's payment_link_code were NOT payment_links rows, so
// the /pay/:code checkout 404'd on both, nothing settled either, and
// flipping an invoice's status by hand moved zero money.
//
// What happens now (mirroring payment-link-checkout's safety pattern):
//   - describe serves the public payload service-role side, so a
//     signed-in third party — exactly who pays — can read it (table
//     RLS is owner-scoped for the writer, useless for the payer).
//   - pay settles through execute_invoice_settlement /
//     execute_payment_request_settlement with a dedicated
//     service-role client (the caller's JWT is never forwarded into
//     the money path). The RPC locks the invoice/request row, flips
//     it to paid in the same transaction as the money, and moves the
//     FULL amount — no platform fee was ever set or disclosed for
//     invoices or requests, so none is taken (escrow precedent).
//   - The public code stays the row's own payment_link_code; NO
//     payment_links rows are created for invoices or requests.
//
// Actions:
//   { action: "describe", kind: "invoice"|"request", code }
//       → { success, invoice|request } public payload.
//   { action: "pay", kind, code, idempotency_key }   (JWT required)
//       → wallet settlement or a plain-language refusal.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ACCOUNT_FROZEN_MESSAGE,
  isAccountFrozen,
} from "../_shared/account-freeze.ts";
import {
  invoicePayableError,
  mapSettlementError,
  requestPayableError,
  selfPayError,
  type SettlementKind,
} from "../_shared/invoice-settlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// deno-lint-ignore no-explicit-any
type Admin = any;

async function ownerEmail(admin: Admin, userId: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Dedicated service-role client — NOT the shared request-scoped
    // one (payment-link-checkout's lesson: a forwarded JWT demotes
    // the call and trips the balance-protection trigger).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const body = await req.json();
    const kind: SettlementKind = body.kind === "request" ? "request" : "invoice";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) {
      return json({ success: false, status: "invalid", error: "A payment code is required." }, 400);
    }

    // ── Load the row by its public code ──
    let invoice: Record<string, unknown> | null = null;
    let request: Record<string, unknown> | null = null;
    if (kind === "invoice") {
      const { data, error } = await admin
        .from("merchant_invoices")
        .select("id, merchant_id, customer_email, customer_name, invoice_number, items, subtotal, tax_amount, total_amount, currency, due_date, notes, status, paid_at, created_at")
        .eq("payment_link_code", code)
        .maybeSingle();
      if (error) throw new Error(error.message);
      invoice = data;
      if (!invoice) {
        return json({ success: false, status: "not_found", error: "Invoice not found." }, 404);
      }
    } else {
      const { data, error } = await admin
        .from("payment_requests")
        .select("id, requester_id, recipient_email, amount, currency, description, status, expires_at, paid_at, created_at")
        .eq("payment_link_code", code)
        .maybeSingle();
      if (error) throw new Error(error.message);
      request = data;
      if (!request) {
        return json({ success: false, status: "not_found", error: "Payment request not found." }, 404);
      }
    }

    const ownerId = String(kind === "invoice" ? invoice!.merchant_id : request!.requester_id);

    // ── describe: the public payload ──
    if (body.action === "describe") {
      const email = await ownerEmail(admin, ownerId);
      if (kind === "invoice") {
        return json({
          success: true,
          invoice: {
            id: invoice!.id,
            invoice_number: invoice!.invoice_number,
            issuer_email: email,
            customer_name: invoice!.customer_name ?? null,
            items: invoice!.items ?? [],
            subtotal: Number(invoice!.subtotal),
            tax_amount: Number(invoice!.tax_amount),
            total_amount: Number(invoice!.total_amount),
            currency: invoice!.currency,
            due_date: invoice!.due_date ?? null,
            notes: invoice!.notes ?? null,
            status: invoice!.status,
            paid_at: invoice!.paid_at ?? null,
          },
        });
      }
      return json({
        success: true,
        request: {
          id: request!.id,
          requester_email: email,
          amount: Number(request!.amount),
          currency: request!.currency,
          description: request!.description ?? null,
          status: request!.status,
          expires_at: request!.expires_at ?? null,
          paid_at: request!.paid_at ?? null,
        },
      });
    }

    if (body.action !== "pay") {
      return json({ success: false, status: "invalid", error: "Unknown action." }, 400);
    }

    // ── pay ──
    const payableError = kind === "invoice"
      ? invoicePayableError(String(invoice!.status))
      : requestPayableError(
          String(request!.status),
          (request!.expires_at as string | null) ?? null,
        );
    if (payableError) {
      return json({ success: false, status: "not_payable", error: payableError }, 400);
    }

    // The payer must be signed in (guests hold no wallet to pay from).
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return json({
        success: false,
        status: "unauthorized",
        error: "Sign in with your BMaGlass account to pay from your wallet balance.",
      }, 401);
    }

    const selfError = selfPayError(kind, user.id, ownerId);
    if (selfError) {
      return json({ success: false, status: "invalid", error: selfError }, 400);
    }

    if (await isAccountFrozen(admin, user.id)) {
      return json({
        success: false,
        status: "account_frozen",
        error: ACCOUNT_FROZEN_MESSAGE,
      }, 403);
    }

    const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
    if (idempotencyKey.length < 8) {
      return json({ success: false, status: "invalid", error: "A valid idempotency_key is required" }, 400);
    }

    const rpcName = kind === "invoice"
      ? "execute_invoice_settlement"
      : "execute_payment_request_settlement";
    const rpcArgs = kind === "invoice"
      ? { p_invoice_id: invoice!.id, p_payer_user_id: user.id, p_idempotency_key: idempotencyKey }
      : { p_request_id: request!.id, p_payer_user_id: user.id, p_idempotency_key: idempotencyKey };

    const { data, error } = await admin.rpc(rpcName, rpcArgs);
    if (error) {
      return json({
        success: false,
        status: "error",
        error: mapSettlementError(error.message || "", kind),
      }, 400);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return json({
      success: true,
      status: "completed",
      transaction_id: row.transaction_id,
      recipient_transaction_id: kind === "invoice"
        ? row.issuer_transaction_id
        : row.requester_transaction_id,
      payer_new_balance: Number(row.payer_new_balance),
      recipient_new_balance: Number(
        kind === "invoice" ? row.issuer_new_balance : row.requester_new_balance,
      ),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Payment could not be processed";
    return json({ success: false, status: "error", error: message }, 400);
  }
});
