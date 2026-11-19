import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import { TablePageSkeleton } from "@/components/ui/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Activity, Bitcoin, RefreshCw, Webhook } from "lucide-react";
import {
  AMOUNT_FIELDS,
  FEE_FIELDS,
  TOGGLE_FIELDS,
  buildSettingsPatch,
  judgeFxHealth,
  judgeSnapshotHealth,
  judgeWebhookHealth,
  readEditableValues,
  settingFieldLabel,
  settingsErrorMessage,
  type HealthJudgement,
  type HealthStatus,
  type SettingField,
  type SettingsValues,
} from "@/lib/platformSettings";
import { toUserFacingError } from "@/utils/userFacingError";

const healthBadgeVariant = (status: HealthStatus) =>
  status === "healthy"
    ? "secondary"
    : status === "attention"
      ? "default"
      : status === "down"
        ? "destructive"
        : "outline";

const healthLabel = (status: HealthStatus) =>
  status === "healthy"
    ? "Healthy"
    : status === "attention"
      ? "Needs a look"
      : status === "down"
        ? "Down"
        : "Unknown";

interface HealthState {
  snapshot: HealthJudgement;
  fx: HealthJudgement;
  webhooks: HealthJudgement;
  checkedAt: Date;
}

const AdminSettings = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [original, setOriginal] = useState<SettingsValues>({});
  const [edited, setEdited] = useState<SettingsValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [health, setHealth] = useState<HealthState | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      // The health queries read tables the generated types predate
      // (p2p_price_snapshots, the current webhook_delivery_logs) —
      // they go through the untyped path other admin pages use for
      // post-types tables (cf. AdminUsers' profiles read).
      const [settingsRes, snapshotRes, fxRes, webhookRes] = await Promise.all([
        supabase.from("platform_settings").select("*").limit(1).single(),
        (supabase as any)
          .from("p2p_price_snapshots")
          .select("created_at, is_stale")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from("exchange_rates")
          .select("rate, valid_until")
          .eq("from_currency", "USD")
          .eq("to_currency", "ZMW")
          .order("valid_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from("webhook_delivery_logs")
          .select("status")
          .gte("created_at", since),
      ]);
      if (settingsRes.error) throw settingsRes.error;

      const values = readEditableValues(
        settingsRes.data as Record<string, unknown>,
      );
      setOriginal(values);
      setEdited(values);
      setFieldErrors({});

      const now = new Date();
      setHealth({
        snapshot: judgeSnapshotHealth(
          (snapshotRes.data as { created_at: string; is_stale: boolean } | null) ??
            null,
          now,
        ),
        fx: judgeFxHealth(
          (fxRes.data as { rate: number; valid_until: string } | null) ?? null,
          now,
        ),
        webhooks: judgeWebhookHealth(
          (webhookRes.data as { status: string | null }[]) ?? [],
        ),
        checkedAt: now,
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Couldn't load platform settings",
        description: toUserFacingError(
          err,
          "We couldn't load the platform settings. Please try again.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    const { patch, errors } = buildSettingsPatch(original, edited);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast({
        title: "Check the highlighted fields",
        description: "Some values aren't valid yet, so nothing was saved.",
        variant: "destructive",
      });
      return;
    }
    const changedKeys = Object.keys(patch);
    if (changedKeys.length === 0) {
      toast({
        title: "Nothing to save",
        description: "You haven't changed any settings.",
      });
      return;
    }
    setIsSaving(true);
    try {
      const { data, error } = await (
        supabase as unknown as {
          rpc: (
            fn: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: unknown }>;
        }
      ).rpc("admin_update_platform_settings", { p_patch: patch });
      if (error) throw error;
      const values = readEditableValues(data as Record<string, unknown>);
      setOriginal(values);
      setEdited(values);
      setFieldErrors({});
      toast({
        title: "Settings saved",
        description: `Updated: ${changedKeys.map(settingFieldLabel).join(", ")}. The change is recorded in the audit log.`,
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Couldn't save settings",
        description: settingsErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderToggle = (field: SettingField) => (
    <div
      key={field.key}
      className="flex items-start justify-between gap-4 py-3 border-b last:border-0"
    >
      <div className="min-w-0">
        <p className="font-medium">{field.label}</p>
        <p className="text-sm text-muted-foreground">{field.help}</p>
      </div>
      <Switch
        checked={edited[field.key] === true}
        onCheckedChange={(checked) =>
          setEdited((prev) => ({ ...prev, [field.key]: checked }))
        }
        aria-label={field.label}
      />
    </div>
  );

  const renderNumber = (field: SettingField) => {
    const value = edited[field.key];
    return (
      <div key={field.key} className="py-3 border-b last:border-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium">{field.label}</p>
            <p className="text-sm text-muted-foreground">{field.help}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={field.kind === "fee" ? 100 : undefined}
              step="any"
              className="w-28"
              value={typeof value === "number" && Number.isFinite(value) ? value : ""}
              onChange={(e) =>
                setEdited((prev) => ({
                  ...prev,
                  [field.key]:
                    e.target.value === "" ? NaN : Number(e.target.value),
                }))
              }
              aria-label={field.label}
            />
            {field.suffix && (
              <span className="text-sm text-muted-foreground">{field.suffix}</span>
            )}
          </div>
        </div>
        {fieldErrors[field.key] && (
          <p className="mt-1 text-sm text-destructive">{fieldErrors[field.key]}</p>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
          <TablePageSkeleton />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <h1 className="text-greeting mb-2">Platform settings</h1>
        <p className="text-muted-foreground mb-6">
          The switches and fees that run BMaGlass Pay. Changes take
          effect straight away and are recorded in the audit log. Only
          super admins can change these.
        </p>

        {health && (
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bitcoin className="h-4 w-4" /> Bitcoin price index
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={healthBadgeVariant(health.snapshot.status)}>
                  {healthLabel(health.snapshot.status)}
                </Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  {health.snapshot.detail}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" /> Exchange rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={healthBadgeVariant(health.fx.status)}>
                  {healthLabel(health.fx.status)}
                </Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  {health.fx.detail}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Webhook className="h-4 w-4" /> Merchant webhooks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={healthBadgeVariant(health.webhooks.status)}>
                  {healthLabel(health.webhooks.status)}
                </Badge>
                <p className="mt-2 text-sm text-muted-foreground">
                  {health.webhooks.detail}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Feature switches</CardTitle>
            </CardHeader>
            <CardContent>{TOGGLE_FIELDS.map(renderToggle)}</CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Platform fees</CardTitle>
              </CardHeader>
              <CardContent>{FEE_FIELDS.map(renderNumber)}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Limits &amp; allowances</CardTitle>
              </CardHeader>
              <CardContent>{AMOUNT_FIELDS.map(renderNumber)}</CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
          <Button variant="outline" onClick={fetchData} disabled={isSaving}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reload
          </Button>
          {health && (
            <span className="text-sm text-muted-foreground">
              Health checked {health.checkedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminSettings;
