import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  cardVaultKeyFromEnv,
  decryptCardDetails,
} from "../_shared/card-vault.ts";

// manage-virtual-card — the checked server path for everything an
// owner does with an existing virtual card after creation day:
//
//   action "reveal"        → full PAN + expiry + CVV, ONLY after the
//                            owner re-enters their account password
//                            (verified against GoTrue here, server
//                            side) and ONLY for cards whose details
//                            sit in the encrypted vault. Legacy
//                            masked-only cards get an honest
//                            `vaulted: false` answer — never an
//                            invented number.
//   action "set_status"    → freeze / unfreeze (active ⇄ frozen)
//   action "set_limits"    → daily / monthly / per-transaction limits
//   action "terminate"     → cancel the card AND wipe its vault
//                            envelope, so its secrets cease to exist
//   action "transactions"  → the card's ledger rows (safe fields)
//
// Every action passes, in order: authentication → the virtual-card
// gate (admin / super_admin role row — the public "Coming soon"
// rule, CEO 2026-10-22, unchanged) → card ownership. Reveals and
// lifecycle actions are written to public.card_access_audit
// (service-role only table). PAN/CVV are never logged and never
// appear in any response except a successful reveal to the owner.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const logStep = (step: string, details?: Record<string, unknown>) => {
  // Details here are ids and action names only — never card secrets.
  console.log(`[MANAGE-VIRTUAL-CARD] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);
};

const CARD_COLUMNS =
  "id, user_id, name, masked_number, expiry_date, balance, currency, status, provider, card_type, has_vaulted_details";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "No authorization header provided" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user?.id) {
      return json({ success: false, error: "User not authenticated" }, 401);
    }
    const user = userData.user;

    // ── The card gate: admin-only while cards are "Coming soon" ──
    const { data: gateRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "super_admin"])
      .limit(1)
      .maybeSingle();
    if (!gateRole) {
      return json(
        { success: false, error: "Virtual cards are coming soon — they're not available yet." },
        403,
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const cardId = body.cardId as string;
    if (!cardId || typeof cardId !== "string") {
      return json({ success: false, error: "A card id is required." }, 400);
    }

    // ── Ownership: the card must belong to the caller. Another
    //    user's card is indistinguishable from a missing one. ──
    const { data: card } = await supabase
      .from("virtual_cards")
      .select(`${CARD_COLUMNS}, details_ciphertext, details_iv, vault_key_version`)
      .eq("id", cardId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!card) {
      return json({ success: false, error: "Virtual card not found" }, 404);
    }

    const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null;
    const audit = async (auditAction: string, success: boolean) => {
      const { error } = await supabase.from("card_access_audit").insert({
        card_id: card.id,
        user_id: user.id,
        action: auditAction,
        success,
        ip_address: clientIp,
      });
      if (error) logStep("Audit write failed", { cardId: card.id, action: auditAction });
    };

    if (action === "reveal") {
      // Re-auth: the caller re-enters their account password; it is
      // verified against GoTrue with a throwaway anon client. The
      // password is never logged or stored.
      const password = body.password as string;
      if (!password || typeof password !== "string") {
        await audit("reveal", false);
        return json({ success: false, error: "Enter your password to view card details." }, 400);
      }
      const anon = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { auth: { persistSession: false } },
      );
      const { error: signInError } = await anon.auth.signInWithPassword({
        email: user.email ?? "",
        password,
      });
      if (signInError) {
        await audit("reveal", false);
        return json(
          { success: false, error: "That password didn't match your account. Card details stay hidden." },
          401,
        );
      }

      if (!card.has_vaulted_details || !card.details_ciphertext || !card.details_iv) {
        await audit("reveal", true);
        // Honest legacy state: this card predates the vault. Its
        // full number and CVV were shown once at creation and were
        // never stored, so there is nothing to reveal — and nothing
        // is invented in their place.
        return json({
          success: true,
          vaulted: false,
          message:
            "This card was created before secure card storage. Its full number and CVV were shown once when it was created and can't be displayed again. The masked number and expiry below are everything that was kept.",
          card: {
            id: card.id,
            masked_number: card.masked_number,
            expiry_date: card.expiry_date,
          },
        });
      }

      const vaultKey = cardVaultKeyFromEnv();
      if (!vaultKey) {
        logStep("Reveal refused: vault key not configured", { cardId: card.id });
        await audit("reveal", false);
        return json(
          { success: false, error: "Card details can't be shown right now. Please try again later." },
          503,
        );
      }

      let details;
      try {
        details = await decryptCardDetails(
          {
            ciphertext: card.details_ciphertext,
            iv: card.details_iv,
            keyVersion: card.vault_key_version ?? 1,
          },
          vaultKey,
        );
      } catch {
        logStep("Reveal refused: vault decrypt failed", { cardId: card.id });
        await audit("reveal", false);
        return json(
          { success: false, error: "Card details can't be shown right now. Please try again later." },
          503,
        );
      }

      await audit("reveal", true);
      return json({
        success: true,
        vaulted: true,
        card: {
          id: card.id,
          card_number: details.pan,
          cvv: details.cvv,
          expiry_date: card.expiry_date,
        },
      });
    }

    if (action === "set_status") {
      const newStatus = body.status as string;
      if (newStatus !== "active" && newStatus !== "frozen") {
        return json({ success: false, error: "Status must be active or frozen." }, 400);
      }
      if (card.status === "cancelled") {
        return json({ success: false, error: "This card has been terminated and can't be changed." }, 409);
      }
      const { error } = await supabase
        .from("virtual_cards")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", card.id);
      if (error) throw new Error("Failed to update card status");
      await audit(newStatus === "frozen" ? "freeze" : "unfreeze", true);
      return json({ success: true, status: newStatus });
    }

    if (action === "set_limits") {
      if (card.status === "cancelled") {
        return json({ success: false, error: "This card has been terminated and can't be changed." }, 409);
      }
      const limits = {
        daily_limit: body.dailyLimit,
        monthly_limit: body.monthlyLimit,
        transaction_limit: body.transactionLimit,
      } as Record<string, unknown>;
      for (const [field, value] of Object.entries(limits)) {
        if (value === undefined) {
          delete limits[field];
          continue;
        }
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 10_000_000) {
          return json({ success: false, error: "Limits must be between 0 and 10,000,000." }, 400);
        }
        limits[field] = n;
      }
      if (Object.keys(limits).length === 0) {
        return json({ success: false, error: "No limits were provided." }, 400);
      }
      const { error } = await supabase
        .from("virtual_cards")
        .update({ ...limits, updated_at: new Date().toISOString() })
        .eq("id", card.id);
      if (error) throw new Error("Failed to update card limits");
      await audit("set_limits", true);
      return json({ success: true, limits });
    }

    if (action === "terminate") {
      if (card.status === "cancelled") {
        return json({ success: false, error: "This card has already been terminated." }, 409);
      }
      // Termination wipes the vault envelope: a cancelled card's
      // secrets cease to exist anywhere in the platform.
      const { error } = await supabase
        .from("virtual_cards")
        .update({
          status: "cancelled",
          details_ciphertext: null,
          details_iv: null,
          vault_key_version: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", card.id);
      if (error) throw new Error("Failed to terminate card");
      await audit("terminate", true);
      return json({ success: true, status: "cancelled" });
    }

    if (action === "transactions") {
      // LIVE columns only (verified 2026-10-26): the transaction
      // kind is carried by `category` and created_at is the row
      // time. Selecting columns the live table doesn't have made
      // PostgREST reject the whole query (500 in the first probe).
      const { data: txs, error } = await supabase
        .from("transactions")
        .select("id, amount, fee_amount, category, status, reference, description, created_at")
        .eq("virtual_card_id", card.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error("Failed to load card transactions");
      return json({ success: true, transactions: txs ?? [] });
    }

    return json({ success: false, error: "Unknown card action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return json({ success: false, error: "Something went wrong with that card action. Please try again." }, 500);
  }
});
