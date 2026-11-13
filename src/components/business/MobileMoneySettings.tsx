import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { toUserFacingError } from "@/utils/userFacingError";
import { CheckCircle2, Loader2, Plug, Smartphone, Unplug } from "lucide-react";

/**
 * Mobile money connection — a merchant connects THEIR OWN mobile
 * money gateway account by pasting their own API keys. Keys are
 * write-only: they are encrypted the moment they are saved and are
 * never shown again (a last-4 hint is all that ever comes back).
 * Collections taken through the connection settle into the
 * merchant's BMaGlass wallet in full; the 1% platform service charge
 * is then collected automatically from the wallet balance (never
 * out of the settlement itself) and listed here, charge by charge.
 */

const WEBHOOK_URL = "https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/momo-webhook";

interface ConnectionSummary {
  connected: boolean;
  environment: "sandbox" | "production";
  key_hint: string | null;
  account_id: string | null;
  connected_at: string;
  updated_at: string;
}

interface MomoStatus {
  facts: {
    has_business: boolean;
    country: string | null;
    zambia: boolean;
    toggle_on: boolean;
    frozen: boolean;
  };
  /** Who pays the 1% service charge on a collection — the
   *  merchant's own choice (CEO decision 2026-11-12). */
  fee_bearer: "seller" | "buyer";
  connections: {
    sandbox: ConnectionSummary | null;
    production: ConnectionSummary | null;
  };
  collections: Array<{
    id: string;
    reference: string;
    amount: number;
    currency: string;
    operator: string;
    status: string;
    source: string;
    environment: string;
    failure_reason: string | null;
    created_at: string;
  }>;
  charges: Array<{
    id: string;
    amount: number;
    currency: string;
    percent: number;
    description: string;
    status: string;
    collected_at: string | null;
    created_at: string;
  }>;
  charges_total_zmw: number;
  charges_collected_total_zmw: number;
  charges_outstanding_total_zmw: number;
  fx_display: { pair: string; rate: number } | null;
}

function EnvironmentSection({
  environment,
  connection,
  onChanged,
}: {
  environment: "sandbox" | "production";
  connection: ConnectionSummary | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [secretKey, setSecretKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const label = environment === "sandbox" ? "Sandbox" : "Live";

  const connect = async () => {
    if (secretKey.trim().length < 16) {
      toast({ title: "Paste your full API secret key", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("momo-settings", {
        body: {
          action: "connect",
          environment,
          secret_key: secretKey.trim(),
          public_key: publicKey.trim() || undefined,
          account_id: accountId.trim() || undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Connection failed");
      setSecretKey("");
      setPublicKey("");
      setAccountId("");
      toast({
        title: `${label} mobile money connected`,
        description: "Your own mobile money account is now linked. Keys are stored encrypted and never shown again.",
      });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't connect", description: toUserFacingError(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("momo-settings", {
        body: { action: "disconnect", environment },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Disconnect failed");
      toast({ title: `${label} mobile money disconnected`, description: "The stored keys were wiped." });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't disconnect", description: toUserFacingError(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (connection) {
    return (
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="font-medium text-sm">{label} account connected</span>
            <Badge variant="secondary">Key ••••{connection.key_hint ?? ""}</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={disconnect} disabled={busy} className="rounded-full">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5 mr-1.5" />}
            Disconnect
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Payments in the {label.toLowerCase()} environment run on your own mobile money account.
          To receive instant payment notifications, set this notification URL in your mobile money dashboard:
        </p>
        <code className="block text-xs bg-muted rounded-md px-3 py-2 break-all">{WEBHOOK_URL}</code>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">Connect your {label.toLowerCase()} account</span>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`momo-secret-${environment}`}>API secret key</Label>
        <Input
          id={`momo-secret-${environment}`}
          type="password"
          autoComplete="off"
          placeholder="Paste the secret key from your mobile money dashboard"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`momo-public-${environment}`}>Public key (optional)</Label>
          <Input
            id={`momo-public-${environment}`}
            autoComplete="off"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`momo-account-${environment}`}>Account ID (optional)</Label>
          <Input
            id={`momo-account-${environment}`}
            autoComplete="off"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Your keys are encrypted as soon as you save them and are never displayed again — you'll see only the last 4 characters.
        {environment === "sandbox" && " Sandbox keys take simulated payments with test phone numbers — no real money moves."}
      </p>
      <Button onClick={connect} disabled={busy} className="rounded-full">
        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Connect {label.toLowerCase()} account
      </Button>
    </div>
  );
}

function FeeBearerSection({
  feeBearer,
  onChanged,
}: {
  feeBearer: "seller" | "buyer";
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const save = async (value: string) => {
    const next = value === "buyer" ? "buyer" : "seller";
    if (next === feeBearer) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("momo-settings", {
        body: { action: "update_fee_bearer", fee_bearer: next },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Couldn't save that choice");
      toast({
        title: next === "buyer" ? "Buyers now pay the service charge" : "You now pay the service charge",
        description:
          next === "buyer"
            ? "Customers pay the product price plus the 1% service charge — you receive the full product amount."
            : "Customers pay exactly the product price — the 1% service charge is collected from your wallet after each payment.",
      });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't save that choice", description: toUserFacingError(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <h4 className="text-sm font-medium">Who pays the service charge?</h4>
      <p className="text-xs text-muted-foreground">
        Every mobile money payment carries a 1% service charge on top of the rail's own fee. Choose who it
        comes from — this applies to your shop plugins, the API and your payment links.
      </p>
      <RadioGroup
        value={feeBearer}
        onValueChange={save}
        disabled={busy}
        className="space-y-3"
      >
        <div className="flex items-start gap-2">
          <RadioGroupItem value="seller" id="momo-fee-bearer-seller" className="mt-0.5" />
          <div>
            <Label htmlFor="momo-fee-bearer-seller" className="text-sm font-medium">
              The seller pays (me)
            </Label>
            <p className="text-xs text-muted-foreground">
              Your customers pay exactly the product price. The 1% charge is collected from your wallet
              balance after each payment settles.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem value="buyer" id="momo-fee-bearer-buyer" className="mt-0.5" />
          <div>
            <Label htmlFor="momo-fee-bearer-buyer" className="text-sm font-medium">
              The buyer pays
            </Label>
            <p className="text-xs text-muted-foreground">
              Your customers pay the product price plus the 1% service charge on top. You receive the full
              product amount from every payment.
            </p>
          </div>
        </div>
      </RadioGroup>
      {busy && <p className="text-xs text-muted-foreground">Saving…</p>}
    </div>
  );
}

export function MobileMoneySettings() {
  const [status, setStatus] = useState<MomoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.functions.invoke("momo-settings", {
        body: { action: "status" },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Could not load mobile money settings");
      setStatus(data as MomoStatus);
    } catch (e) {
      setLoadError(toUserFacingError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (loadError || !status) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        {loadError ?? "Mobile money settings couldn't be loaded."}{" "}
        <button className="text-primary underline underline-offset-2" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const { facts } = status;

  if (!facts.has_business) {
    return (
      <p className="text-sm text-muted-foreground">
        Set up your business profile first — mobile money connects to your business account.
      </p>
    );
  }
  if (!facts.zambia) {
    return (
      <p className="text-sm text-muted-foreground">
        Mobile money is currently available to businesses registered in Zambia. Your business is registered in{" "}
        {facts.country ?? "another country"}, so it can't be switched on yet.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Connect your own mobile money account and customers can pay you with MTN, Airtel or Zamtel mobile
          money — in your shop plugins, through the API, and on your payment links. Payments settle into your
          BMaGlass wallet in full — the 1% service charge for each payment is collected afterwards from your
          wallet balance, never out of the settlement itself, and every charge is listed below.
          {status.fee_bearer === "buyer"
            ? " Your customers pay the product price plus the charge, so each settlement leaves the full product amount in your wallet."
            : ""}
        </p>
      </div>

      {!facts.toggle_on && (
        <p className="text-sm rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3">
          Your mobile money switch is currently <strong>off</strong>. Connect your account below, then switch
          mobile money on in Business Settings so customers can pay you this way.
        </p>
      )}

      <FeeBearerSection feeBearer={status.fee_bearer ?? "seller"} onChanged={load} />

      <EnvironmentSection
        environment="production"
        connection={status.connections.production}
        onChanged={load}
      />
      <EnvironmentSection
        environment="sandbox"
        connection={status.connections.sandbox}
        onChanged={load}
      />

      {status.fx_display && (
        <p className="text-xs text-muted-foreground">
          Indicative rate for display: 1 USD ≈ ZMW {status.fx_display.rate.toFixed(2)}. Mobile money payments
          themselves are always in Zambian Kwacha.
        </p>
      )}

      {status.collections.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Recent mobile money payments</h4>
          <div className="divide-y divide-border rounded-lg border border-border">
            {status.collections.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">
                    {c.currency} {Number(c.amount).toFixed(2)}
                  </span>{" "}
                  <span className="text-muted-foreground capitalize">· {c.operator}</span>
                  {c.environment === "sandbox" && (
                    <Badge variant="outline" className="ml-2">Sandbox</Badge>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleString()}
                    {c.status === "failed" && c.failure_reason ? ` — ${c.failure_reason}` : ""}
                  </div>
                </div>
                <Badge
                  variant={c.status === "successful" ? "default" : c.status === "failed" ? "destructive" : "secondary"}
                  className="capitalize"
                >
                  {c.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {status.charges.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">
            Mobile money service charges (1%) — total ZMW {status.charges_total_zmw.toFixed(2)}
          </h4>
          <div className="divide-y divide-border rounded-lg border border-border">
            {status.charges.map((ch) => (
              <div key={ch.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <span className="text-muted-foreground">{ch.description}</span>
                  <div className="text-xs text-muted-foreground">
                    {new Date(ch.created_at).toLocaleString()}
                    {ch.status === "collected" && ch.collected_at
                      ? ` — collected ${new Date(ch.collected_at).toLocaleString()}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {ch.currency} {Number(ch.amount).toFixed(2)}
                  </span>
                  <Badge
                    variant={ch.status === "collected" ? "default" : "secondary"}
                    className="capitalize"
                  >
                    {ch.status === "collected" ? "Collected" : "Outstanding"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Collected ZMW {status.charges_collected_total_zmw.toFixed(2)} · Outstanding ZMW{" "}
            {status.charges_outstanding_total_zmw.toFixed(2)}. Charges are collected automatically from
            your wallet balance after each settlement is credited in full; if your balance is too low, a
            charge stays outstanding and is collected as soon as funds are available.
          </p>
        </div>
      )}
    </div>
  );
}
