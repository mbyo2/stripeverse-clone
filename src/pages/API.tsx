import { toUserFacingError } from "@/utils/userFacingError";
import React, { useState, useEffect, useCallback } from "react";
import { SkeletonListRows } from "@/components/ui/skeletons";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Key, Book, Plus, Trash2, Pencil, AlertTriangle, Webhook as WebhookIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface WebhookRow {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
}

// Only events the developer platform actually emits today.
const AVAILABLE_EVENTS = [
  "transaction.completed",
  "payment_link.created",
  "payment_link.paid",
  "webhook.test",
];

const AVAILABLE_SCOPES = [
  "wallets:read",
  "transactions:read",
  "transfers:write",
  "payment_links:read",
  "payment_links:write",
  "bitcoin:read",
];

const API = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);

  // New-key dialog
  const [genOpen, setGenOpen] = useState(false);
  const [genName, setGenName] = useState("");
  const [genType, setGenType] = useState<"live" | "test">("live");
  const [genScopes, setGenScopes] = useState<string[]>(AVAILABLE_SCOPES);
  const [genLoading, setGenLoading] = useState(false);
  // Full key shown exactly once
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [freshKeyName, setFreshKeyName] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<{ id: string; name: string } | null>(null);
  const [pendingDeleteWebhook, setPendingDeleteWebhook] = useState<{ id: string; url: string } | null>(null);

  // Webhooks
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(true);
  const [whUrl, setWhUrl] = useState("");
  const [whEvents, setWhEvents] = useState<string[]>([]);
  const [editingWh, setEditingWh] = useState<WebhookRow | null>(null);
  const [savingWh, setSavingWh] = useState(false);
  const [freshWhSecret, setFreshWhSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);

  const loadKeys = useCallback(async () => {
    if (!user) return;
    setLoadingKeys(true);
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, is_active, last_used_at, expires_at, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load API keys", description: toUserFacingError(error), variant: "destructive" });
    } else {
      setApiKeys(data || []);
    }
    setLoadingKeys(false);
  }, [user, toast]);

  const loadWebhooks = useCallback(async () => {
    if (!user) return;
    setLoadingWebhooks(true);
    const { data, error } = await supabase
      .from("developer_webhooks" as any)
      .select("id, url, events, is_active, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load webhooks", description: toUserFacingError(error), variant: "destructive" });
    } else {
      setWebhooks(data || []);
    }
    const { data: del } = await supabase
      .from("developer_webhook_deliveries" as any)
      .select("id, event_type, webhook_url, status, response_status, error_message, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    setDeliveries((del as any) || []);
    setLoadingWebhooks(false);
  }, [user, toast]);

  useEffect(() => {
    loadKeys();
    loadWebhooks();
  }, [loadKeys, loadWebhooks]);

  const generateNewKey = async () => {
    if (!genName.trim()) {
      toast({ title: "Name required", description: "Give the key a name first.", variant: "destructive" });
      return;
    }
    setGenLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-api-key", {
        body: { name: genName.trim(), type: genType, scopes: genScopes },
      });
      if (error) throw new Error(error.message);
      if (!data?.key) throw new Error("No key returned");
      setFreshKey(data.key);
      setFreshKeyName(data.name || genName.trim());
      setGenName("");
      loadKeys();
      toast({ title: "API key created", description: "Copy it now — it will never be shown again." });
    } catch (e: any) {
      toast({ title: "Failed to create key", description: toUserFacingError(e), variant: "destructive" });
    } finally {
      setGenLoading(false);
    }
  };

  const revokeKey = async (id: string, name: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("revoke-api-key", {
        body: { key_id: id },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error("Revoke failed");
      toast({ title: "Key revoked", description: `"${name}" can no longer be used.` });
      loadKeys();
    } catch (e: any) {
      toast({ title: "Revoke failed", description: toUserFacingError(e), variant: "destructive" });
    }
  };

  const copyToClipboard = (text: string, label = "Copied to clipboard") => {
    navigator.clipboard.writeText(text);
    toast({ title: label });
  };

  // ── Webhooks ──────────────────────────────────────────────

  const toggleEvent = (ev: string) => {
    setWhEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  };

  const startEditWebhook = (wh: WebhookRow) => {
    setEditingWh(wh);
    setWhUrl(wh.url);
    setWhEvents(wh.events);
  };

  const cancelEditWebhook = () => {
    setEditingWh(null);
    setWhUrl("");
    setWhEvents([]);
  };

  const saveWebhook = async () => {
    let parsed: URL;
    try {
      parsed = new URL(whUrl.trim());
      if (parsed.protocol !== "https:") throw new Error("bad protocol");
    } catch {
      toast({ title: "Invalid URL", description: "Enter a valid HTTPS URL — developer webhooks require HTTPS.", variant: "destructive" });
      return;
    }
    if (whEvents.length === 0) {
      toast({ title: "No events selected", description: "Choose at least one event.", variant: "destructive" });
      return;
    }
    setSavingWh(true);
    try {
      if (editingWh) {
        const { error } = await supabase
          .from("developer_webhooks" as any)
          .update({ url: parsed.toString(), events: whEvents, updated_at: new Date().toISOString() })
          .eq("id", editingWh.id);
        if (error) throw error;
        toast({ title: "Webhook updated" });
      } else {
        // Generate a signing secret for this endpoint (shown in webhook detail; stored per-row)
        const secretBytes = new Uint8Array(24);
        crypto.getRandomValues(secretBytes);
        const secret = "whsec_" + Array.from(secretBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        const { error } = await supabase.from("developer_webhooks" as any).insert({
          user_id: user!.id,
          url: parsed.toString(),
          events: whEvents,
          secret,
        });
        if (error) throw error;
        setFreshWhSecret(secret);
        toast({ title: "Webhook added", description: "Copy the signing secret now — it is shown only once." });
      }
      cancelEditWebhook();
      loadWebhooks();
    } catch (e: any) {
      toast({ title: "Save failed", description: toUserFacingError(e), variant: "destructive" });
    } finally {
      setSavingWh(false);
    }
  };

  const deleteWebhook = async (id: string, url: string) => {
    const { error } = await supabase.from("developer_webhooks" as any).delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: toUserFacingError(error), variant: "destructive" });
    } else {
      toast({ title: "Webhook deleted" });
      loadWebhooks();
    }
  };

  const toggleWebhook = async (wh: WebhookRow) => {
    const { error } = await supabase.from("developer_webhooks" as any).update({ is_active: !wh.is_active }).eq("id", wh.id);
    if (error) {
      toast({ title: "Update failed", description: toUserFacingError(error), variant: "destructive" });
    } else {
      loadWebhooks();
    }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : "—";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">API Management</h1>
          <p className="text-muted-foreground">
            Manage your API keys and integration settings
          </p>
        </div>

        {/* The documentation is public; key and webhook management are
            account-specific and only render for signed-in users. */}
        {!user && (
          <Card className="mb-6">
            <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4 pt-6">
              <div className="flex-1">
                <p className="font-medium">You're reading the public API documentation</p>
                <p className="text-sm text-muted-foreground">
                  Sign in to create API keys and manage webhooks for your account.
                </p>
              </div>
              <Button asChild>
                <Link to="/login">Sign In</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue={user ? "keys" : "docs"} className="space-y-6">
          <TabsList className={`grid w-full ${user ? "grid-cols-3" : "grid-cols-1"}`}>
            {user && <TabsTrigger value="keys">API Keys</TabsTrigger>}
            <TabsTrigger value="docs">Documentation</TabsTrigger>
            {user && <TabsTrigger value="webhooks">Webhooks</TabsTrigger>}
          </TabsList>

          {user && (
          <TabsContent value="keys">
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    API Keys
                  </CardTitle>
                  <Button onClick={() => { setFreshKey(null); setGenOpen(true); }}>
                    <Plus className="h-4 w-4 mr-1" /> Generate New Key
                  </Button>
                </CardHeader>
                <CardContent>
                  {loadingKeys ? (
                    <SkeletonListRows rows={2} />
                  ) : apiKeys.length === 0 ? (
                    <div className="text-center py-8">
                      <Key className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No API keys yet. Generate one to get started.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {apiKeys.map((key) => (
                        <div key={key.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-medium">{key.name}</h3>
                              <Badge variant={key.is_active ? "default" : "secondary"}>
                                {key.is_active ? "active" : "revoked"}
                              </Badge>
                              {key.expires_at && new Date(key.expires_at) < new Date() && (
                                <Badge variant="destructive">expired</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                                {key.key_prefix}••••••••
                              </code>
                              <span className="text-xs text-muted-foreground">
                                Full key shown only at creation
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              Created: {fmtDate(key.created_at)} • Last used: {fmtDate(key.last_used_at)}
                            </p>
                          </div>
                          {key.is_active && (
                            <Button variant="destructive" size="sm" onClick={() => setPendingRevoke({ id: key.id, name: key.name })}>
                              Revoke
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          )}

          <TabsContent value="docs">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Book className="h-5 w-5" />
                  API Documentation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-2">Quick Start</h3>
                    <p className="text-sm text-muted-foreground mb-2">
                      Authenticate with your API key in the X-Api-Key header against the
                      developer-api base URL below. Sign in and open the API Keys tab to
                      create one — keys are shown only once. Test keys (bmp_test_) are
                      read-only: this app has no test-mode ledger, so a test key can
                      never move real money. Live keys (bmp_live_) move real money.
                    </p>
                    <div className="bg-muted p-4 rounded-lg">
                      <pre className="text-sm overflow-x-auto">
{`curl https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/developer-api/wallets \\
  -H "X-Api-Key: bmp_test_your_key_here"`}
                      </pre>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-medium mb-2">Shipped endpoints (developer-api)</h3>
                    <p className="text-sm text-muted-foreground">
                      Full contract: <a className="underline" href="/openapi.json" target="_blank" rel="noreferrer">/openapi.json</a>.
                      Not available via the API: MoonPay and third-party card issuing — those rails are not live for API use and are not stubbed.
                    </p>
                    <div className="space-y-2">
                      {[
                        { fn: "GET /wallets", desc: "List your wallets and balances — scope wallets:read" },
                        { fn: "GET /transactions", desc: "Recent transactions — scope transactions:read" },
                        { fn: "POST /transfers", desc: "Wallet-to-wallet transfer, 1.5% fee — live keys only, scope transfers:write" },
                        { fn: "GET /payment-links", desc: "List payment links — scope payment_links:read" },
                        { fn: "POST /payment-links", desc: "Create a payment link — live keys only, scope payment_links:write" },
                        { fn: "GET /payment-links/{id}/attempts", desc: "A link's Bitcoin payment attempts — scope payment_links:read" },
                        { fn: "GET /settings", desc: "Your fee-bearer default and the platform fee rates (link rate + PayPal rate) — any valid key" },
                        { fn: "GET /bitcoin/balance", desc: "Custodial Bitcoin balance — scope bitcoin:read" },
                        { fn: "GET /bitcoin/deposit-address", desc: "Your issued custodial deposit address — scope bitcoin:read" },
                        { fn: "POST /bitcoin/quote", desc: "60-second BTC buy/sell quote (execution stays in the app) — scope bitcoin:read" },
                        { fn: "POST /webhooks", desc: "Register a webhook endpoint — signing secret shown once" },
                        { fn: "GET /webhook-deliveries", desc: "Webhook delivery log" },
                      ].map((e) => (
                        <div key={e.fn} className="flex items-center justify-between p-3 border rounded">
                          <div>
                            <span className="font-mono text-sm">{e.fn}</span>
                            <p className="text-sm text-muted-foreground">{e.desc}</p>
                          </div>
                          <Badge variant="outline">Live</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {user && (
          <TabsContent value="webhooks">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <WebhookIcon className="h-5 w-5" />
                  Webhook Endpoints
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                    <div className="flex gap-2">
                      <Input
                        placeholder="https://your-site.com/webhook"
                        value={whUrl}
                        onChange={(e) => setWhUrl(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">Events</Label>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_EVENTS.map((ev) => (
                          <label key={ev} className="flex items-center gap-1.5 text-xs border rounded px-2 py-1 cursor-pointer">
                            <Checkbox
                              checked={whEvents.includes(ev)}
                              onCheckedChange={() => toggleEvent(ev)}
                            />
                            <span className="font-mono">{ev}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={saveWebhook} disabled={savingWh} size="sm">
                        {editingWh ? "Update Webhook" : "Add Webhook"}
                      </Button>
                      {editingWh && (
                        <Button variant="outline" onClick={cancelEditWebhook} size="sm">Cancel</Button>
                      )}
                    </div>
                  </div>

                  {freshWhSecret && (
                    <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 space-y-2">
                      <p className="text-sm">Copy this signing secret now — it will never be shown again:</p>
                      <code className="block bg-muted px-3 py-2 rounded text-sm font-mono break-all">{freshWhSecret}</code>
                      <Button variant="outline" size="sm" onClick={() => { copyToClipboard(freshWhSecret, "Webhook secret copied"); setFreshWhSecret(null); }}>Copied — dismiss</Button>
                    </div>
                  )}
                  {loadingWebhooks ? (
                    <SkeletonListRows rows={2} />
                  ) : webhooks.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No webhook endpoints yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {webhooks.map((wh) => (
                        <div key={wh.id} className="flex items-center justify-between p-3 border rounded">
                          <div className="flex-1 min-w-0">
                            <span className="font-mono text-sm break-all">{wh.url}</span>
                            <p className="text-sm text-muted-foreground truncate">
                              {wh.events.join(", ") || "no events"}
                            </p>
                          </div>
                          <div className="flex gap-2 items-center ml-2">
                            <Badge
                              variant={wh.is_active ? "default" : "secondary"}
                              className="cursor-pointer"
                              onClick={() => toggleWebhook(wh)}
                            >
                              {wh.is_active ? "Active" : "Paused"}
                            </Badge>
                            <Button variant="outline" size="sm" onClick={() => startEditWebhook(wh)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => setPendingDeleteWebhook({ id: wh.id, url: wh.url })}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {deliveries.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Recent deliveries</h4>
                      {deliveries.map((d: any) => (
                        <div key={d.id} className="flex items-center justify-between p-3 border rounded text-sm">
                          <span className="font-mono">{d.event_type}</span>
                          <span className="text-muted-foreground truncate mx-2">{d.webhook_url}</span>
                          <Badge variant={d.status === "delivered" ? "default" : "secondary"}>{d.status}{d.response_status ? ` · HTTP ${d.response_status}` : ""}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
      </main>

      {/* Generate key dialog — full key shown ONCE */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
            <DialogDescription>
              The full key is shown exactly once. Store it securely — it can never be retrieved again.
            </DialogDescription>
          </DialogHeader>
          {!freshKey ? (
            <div className="space-y-4">
              <div>
                <Label>Key name</Label>
                <Input
                  placeholder="e.g. Production server"
                  value={genName}
                  onChange={(e) => setGenName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Environment</Label>
                <Select value={genType} onValueChange={(v) => setGenType(v as "live" | "test")}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="test">Test</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Test keys are always read-only in practice — writes with a test key are refused, whatever scopes are selected.</p>
              </div>
              <div>
                <Label>Scopes</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {AVAILABLE_SCOPES.map((sc) => (
                    <label key={sc} className="flex items-center gap-1.5 text-xs border rounded px-2 py-1 cursor-pointer">
                      <Checkbox checked={genScopes.includes(sc)} onCheckedChange={() => setGenScopes((prev) => prev.includes(sc) ? prev.filter((x) => x !== sc) : [...prev, sc])} />
                      <span className="font-mono">{sc}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700">
                  Copy <strong>{freshKeyName}</strong> now. You will never see it again.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono break-all">{freshKey}</code>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(freshKey, "API key copied")}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            {!freshKey ? (
              <>
                <Button variant="outline" onClick={() => setGenOpen(false)}>Cancel</Button>
                <Button onClick={generateNewKey} disabled={genLoading}>
                  {genLoading ? "Generating…" : "Generate Key"}
                </Button>
              </>
            ) : (
              <Button onClick={() => { setGenOpen(false); setFreshKey(null); }}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingRevoke} onOpenChange={(open) => { if (!open) setPendingRevoke(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingRevoke?.name}" will stop working immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRevoke) {
                  const target = pendingRevoke;
                  setPendingRevoke(null);
                  revokeKey(target.id, target.name);
                }
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingDeleteWebhook} onOpenChange={(open) => { if (!open) setPendingDeleteWebhook(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              The webhook at {pendingDeleteWebhook?.url} will be removed and will stop receiving events. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteWebhook) {
                  const target = pendingDeleteWebhook;
                  setPendingDeleteWebhook(null);
                  deleteWebhook(target.id, target.url);
                }
              }}
            >
              Delete webhook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  );
};

export default API;
