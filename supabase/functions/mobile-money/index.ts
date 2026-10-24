// mobile-money: KYC actions + (refused) external provider actions.
//
// History: this function "processed" MTN / Airtel / Zamtel payments,
// bank transfers, USSD and card payments with setTimeout delays and
// Math.random() success rolls (90% / 85%), inventing provider
// references and writing those fictions into the transactions table.
// None of it ever touched a real gateway.
//
// Now the two concerns are separated cleanly:
//   * KYC actions ('kyc-verification', 'check-kyc') are REAL database
//     work against kyc_verifications and are unchanged in behaviour
//     (they now receive the Supabase client explicitly — they used to
//     reference an undefined module-global `supabase`, so the repo
//     version could not have run them at all).
//   * Every provider action answers truthfully: this platform has no
//     live mobile-money / bank / USSD / card gateway connected, so the
//     response is status 'not_configured' (see
//     _shared/payment-providers.ts). Nothing is written to the
//     database and no reference is invented for a payment no gateway
//     will ever settle. Wallet-to-wallet transfers never belonged
//     here — they run through atomic-transfer.
//
// Callers today: KycVerification.tsx and Compliance.tsx (KYC actions
// only). No frontend calls the provider actions.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { classifyProvider } from "../_shared/payment-providers.ts";
import {
  buildKycDocumentInsertFields,
  buildKycDocumentUpdateFields,
} from "../_shared/kyc-submission.ts";
import {
  KYC_WRITE_LOST_MESSAGE,
  assertKycWriteLanded,
  isKycWriteLostError,
} from "../_shared/kyc-write.ts";
import {
  PHONE_STAMP_AUDIT_FAILED_MESSAGE,
  PHONE_STAMP_FAILED_MESSAGE,
  PHONE_STAMP_FORBIDDEN_MESSAGE,
  PHONE_STAMP_SUCCESS_MESSAGE,
  hasPhoneStampAdmin,
  validatePhoneForStamp,
  validatePhoneStampTarget,
} from "../_shared/phone-stamp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Authenticated client (service role key + the caller's Authorization
// header, as this function has always run). Used ONLY for the KYC
// database actions below.
const getSupabaseClient = (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader || "" } },
    },
  );
};

// Service-role client WITHOUT forwarding the caller's Authorization
// header. Required for the admin phone-stamp action: the role check,
// the GoTrue admin stamp and the audit insert must run as
// service_role, not in the caller's `authenticated` PostgREST role
// (same reasoning as _shared/supabase-client.ts getServiceRoleClient).
const getServiceRoleClient = () => {
  return createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
};

// ── KYC (real) ───────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof getSupabaseClient>;

enum KycVerificationLevel {
  NONE = "none",
  BASIC = "basic",
  FULL = "full",
}

async function verifyKyc(
  supabase: SupabaseClient,
  userId: string,
  data: Record<string, unknown>,
): Promise<{ level: KycVerificationLevel; message: string }> {
  // Check if the user already has KYC verification
  const { data: existingKyc, error: kycError } = await supabase
    .from("kyc_verifications")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (kycError) throw kycError;

  // If user already has full verification, return that
  if (existingKyc && existingKyc.level === KycVerificationLevel.FULL && existingKyc.verified_at) {
    return { level: KycVerificationLevel.FULL, message: "Your account is already fully verified." };
  }

  const { firstName, lastName, idType, idNumber, dateOfBirth, address, selfieImage } = data as {
    firstName?: string; lastName?: string; idType?: string; idNumber?: string;
    dateOfBirth?: string; address?: string; selfieImage?: string;
  };

  if (!firstName || !lastName || !idType || !idNumber || !dateOfBirth) {
    return { level: KycVerificationLevel.NONE, message: "Missing required verification information." };
  }

  // Full when the advanced evidence is supplied, basic otherwise.
  // Submission is for review: verified_at is set by an admin, never here.
  const verificationLevel = address && selfieImage
    ? KycVerificationLevel.FULL
    : KycVerificationLevel.BASIC;

  if (existingKyc) {
    // .select("id") requests the written row back: a 0-row update
    // returns no PostgREST error, so without it a blocked write used
    // to pass as success while nothing was saved (the re-submission
    // bug). assertKycWriteLanded turns that into a hard failure.
    const { data: updatedRows, error: updateError } = await supabase
      .from("kyc_verifications")
      .update({
        level: verificationLevel,
        first_name: firstName,
        last_name: lastName,
        id_type: idType,
        id_number: idNumber,
        date_of_birth: dateOfBirth,
        address: address || existingKyc.address,
        selfie_url: selfieImage || existingKyc.selfie_url,
        // Document URLs (idFrontUrl/idBackUrl/addressDocUrl or their
        // snake_case aliases) — fall back to the stored values when
        // the new submission omits them, like address/selfie above.
        ...buildKycDocumentUpdateFields(data, existingKyc),
        updated_at: new Date().toISOString(),
        metadata: {},
      })
      .eq("user_id", userId)
      .select("id");
    if (updateError) throw updateError;
    assertKycWriteLanded(updatedRows);
  } else {
    const { data: insertedRows, error: insertError } = await supabase
      .from("kyc_verifications")
      .insert({
        user_id: userId,
        level: verificationLevel,
        first_name: firstName,
        last_name: lastName,
        id_type: idType,
        id_number: idNumber,
        date_of_birth: dateOfBirth,
        address: address || null,
        selfie_url: selfieImage || null,
        // Document URLs — null when the submission did not provide them.
        ...buildKycDocumentInsertFields(data),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      })
      .select("id");
    if (insertError) throw insertError;
    assertKycWriteLanded(insertedRows);
  }

  return {
    level: verificationLevel,
    message: verificationLevel === KycVerificationLevel.FULL
      ? "Your full verification has been submitted for review."
      : "Basic verification completed. Full verification is pending review.",
  };
}

async function checkKycLevel(
  supabase: SupabaseClient,
  userId: string,
): Promise<KycVerificationLevel> {
  try {
    if (!userId) return KycVerificationLevel.NONE;

    const { data, error } = await supabase
      .from("kyc_verifications")
      .select("level, verified_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return KycVerificationLevel.NONE;

    // Until an admin approves (verified_at set), a FULL submission
    // counts as BASIC.
    if (!data.verified_at && data.level === KycVerificationLevel.FULL) {
      return KycVerificationLevel.BASIC;
    }

    return (data.level as KycVerificationLevel) || KycVerificationLevel.NONE;
  } catch (error) {
    console.error("Error checking KYC level:", error);
    return KycVerificationLevel.NONE;
  }
}

// ── Provider actions (truthful refusal) ─────────────────────────────

function notConfigured(providerKey: string) {
  const route = classifyProvider(providerKey, {
    paypalConfigured: Boolean(
      Deno.env.get("PAYPAL_CLIENT_ID") && Deno.env.get("PAYPAL_CLIENT_SECRET"),
    ),
  });
  // classifyProvider only returns 'paypal' for providerKey 'paypal',
  // which is never routed to this endpoint.
  const message = route.kind === "not_configured"
    ? route.error
    : "This payment method is not handled by this endpoint.";
  return json({ success: false, status: "not_configured", error: message });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const supabase = getSupabaseClient(req);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error("Authentication failed:", authError);
      return json({ error: "Unauthorized - Authentication required" }, 401);
    }

    const requestData = await req.json();
    const { paymentMethod } = requestData;

    // ── Admin action: stamp a phone number as confirmed ──
    // Dispatched BEFORE the KYC own-record guard below: by design it
    // acts on ANOTHER user. It is still after authentication, and it
    // additionally requires an admin / super_admin role (checked via
    // a service-role client that does not forward the caller header).
    // Interim mechanism for vetted early users: P2P tier T1 requires
    // auth.users.phone_confirmed_at, which no user flow can write —
    // only the GoTrue admin API stamps it.
    if (paymentMethod === "admin-stamp-phone") {
      const service = getServiceRoleClient();

      const { data: roleRows, error: roleError } = await service
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (roleError) {
        console.error("admin-stamp-phone: role lookup failed:", roleError);
      }
      const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
      if (!hasPhoneStampAdmin(roles)) {
        return json(
          { success: false, error: PHONE_STAMP_FORBIDDEN_MESSAGE, message: PHONE_STAMP_FORBIDDEN_MESSAGE },
          403,
        );
      }

      const target = validatePhoneStampTarget(requestData.userId);
      if (!target.ok) {
        return json({ success: false, error: target.error, message: target.error }, 400);
      }
      const phoneCheck = validatePhoneForStamp(requestData.phone);
      if (!phoneCheck.ok) {
        return json({ success: false, error: phoneCheck.error, message: phoneCheck.error }, 400);
      }

      const { error: stampError } = await service.auth.admin.updateUserById(
        target.userId,
        { phone: phoneCheck.phone, phone_confirm: true },
      );
      if (stampError) {
        console.error("admin-stamp-phone: GoTrue stamp failed:", stampError);
        return json(
          { success: false, error: PHONE_STAMP_FAILED_MESSAGE, message: PHONE_STAMP_FAILED_MESSAGE },
          500,
        );
      }

      // Audit is REQUIRED, not best-effort. Choice (documented per
      // spec): if the audit insert fails we return 500 even though
      // the GoTrue stamp has already happened and cannot be rolled
      // back — the phone IS confirmed at that point, but returning
      // success would silently lose the audit trail for a privileged
      // action. The error tells the admin the audit failed so it can
      // be surfaced / reconciled instead of hidden.
      const { error: auditError } = await service
        .from("audit_logs")
        .insert({
          user_id: user.id,
          action: "admin_phone_stamp",
          table_name: "auth.users",
          record_id: target.userId,
          new_values: { phone: phoneCheck.phone },
        });
      if (auditError) {
        console.error(
          "admin-stamp-phone: AUDIT INSERT FAILED after successful stamp — " +
            "phone was confirmed for target but no audit row was written:",
          auditError,
        );
        return json(
          { success: false, error: PHONE_STAMP_AUDIT_FAILED_MESSAGE, message: PHONE_STAMP_AUDIT_FAILED_MESSAGE },
          500,
        );
      }

      return json({ success: true, message: PHONE_STAMP_SUCCESS_MESSAGE });
    }

    // ── KYC actions (real DB work) ──
    if (paymentMethod === "kyc-verification" || paymentMethod === "check-kyc") {
      const { userId, data } = requestData;
      if (!userId) {
        return json({ error: "User ID is required for KYC actions" }, 400);
      }
      // A caller may only act on their own KYC record.
      if (userId !== user.id) {
        return json({ error: "Forbidden: cannot act on another user's KYC record" }, 403);
      }

      if (paymentMethod === "kyc-verification") {
        try {
          const result = await verifyKyc(supabase, userId, data || {});
          return json(result);
        } catch (error) {
          console.error("KYC verification error:", error);
          // A write that landed on 0 rows is NOT a generic failure:
          // answer with the crafted plain-language message so the
          // user learns nothing was saved (never a silent success).
          if (isKycWriteLostError(error)) {
            return json(
              { success: false, error: KYC_WRITE_LOST_MESSAGE, message: KYC_WRITE_LOST_MESSAGE },
              500,
            );
          }
          return json({ error: "Failed to process KYC verification" }, 500);
        }
      }

      const level = await checkKycLevel(supabase, userId);
      return json({ level });
    }

    // ── Provider actions: no live gateway is connected ──
    if (paymentMethod === "mobile-money") {
      const provider = String(requestData.provider || "mobile_money").toLowerCase();
      return notConfigured(provider);
    }
    if (paymentMethod === "bank-transfer") return notConfigured("bank_transfer");
    if (paymentMethod === "ussd") return notConfigured("ussd");
    if (paymentMethod === "card") return notConfigured("card");
    if (paymentMethod === "wallet-transfer") return notConfigured("wallet");

    return json({ error: "Unsupported payment method" }, 400);
  } catch (error) {
    console.error("Error processing request:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
