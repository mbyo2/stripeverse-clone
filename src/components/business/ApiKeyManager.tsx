import { toUserFacingError } from "@/utils/userFacingError";
import { useCallback, useEffect, useState } from "react";
import { CopyIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";

// API keys live in two environments (CEO-approved design, 2026-11-09):
//   production — bmg_live_ keys (legacy bmp_live_): real money.
//   sandbox    — bmg_sandbox_ keys (legacy bmp_test_): mainnet
//                formats, simulated money — payments settle only
//                through simulation, never from a real wallet.
// The environment is a property of the key itself; nothing in a
// plugin or SDK setting can change it.
type KeyEnvironment = "production" | "sandbox";

interface ApiKey {
  id: string;
  name: string | null;
  prefix: string;
  createdAt: string;
  environment: KeyEnvironment;
  scopes: string[];
  revoked?: boolean;
  graceUntil?: string | null;
}

interface ApiKeyRow {
  id: string;
  name: string | null;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  scopes: string[] | null;
  rotation_grace_until: string | null;
}

function environmentOfPrefix(prefix: string): KeyEnvironment {
  return prefix.includes("live") ? "production" : "sandbox";
}

export function ApiKeyManager() {
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [liveKeys, setLiveKeys] = useState<ApiKey[]>([]);
  const [sandboxKeys, setSandboxKeys] = useState<ApiKey[]>([]);
  // A newly generated or rotated key is shown in full exactly once —
  // only its hash is stored server-side, so it can never be
  // retrieved again.
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const { toast } = useToast();

  const loadKeys = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, is_active, created_at, scopes, rotation_grace_until")
      .order("created_at", { ascending: false });
    if (error) {
      toast({
        title: "Failed to load API keys",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    } else {
      const rows = (data || []) as unknown as ApiKeyRow[];
      const mapped: ApiKey[] = rows.map(row => ({
        id: row.id,
        name: row.name,
        prefix: row.key_prefix,
        createdAt: row.created_at,
        environment: environmentOfPrefix(row.key_prefix),
        scopes: row.scopes ?? [],
        revoked: !row.is_active,
        graceUntil: row.rotation_grace_until,
      }));
      setLiveKeys(mapped.filter(k => k.environment === 'production'));
      setSandboxKeys(mapped.filter(k => k.environment === 'sandbox'));
    }
    setIsLoading(false);
  }, [user, toast]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const generateNewKey = async (environment: KeyEnvironment) => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-api-key', {
        body: { type: environment }
      });

      if (error) throw error;

      const newKey: ApiKey = {
        id: data.id,
        name: data.name ?? null,
        prefix: data.key_prefix,
        createdAt: data.created_at,
        environment,
        scopes: data.scopes ?? [],
        revoked: false,
      };

      if (environment === 'production') {
        setLiveKeys(prev => [newKey, ...prev]);
      } else {
        setSandboxKeys(prev => [newKey, ...prev]);
      }

      if (data.key) {
        setFreshKey(data.key);
      }

      toast({
        title: "New API Key Generated",
        description: `Your new ${environment} API key has been generated successfully.`,
      });
    } catch (error) {
      console.error('Error generating API key:', error);
      toast({
        title: "Error",
        description: "Failed to generate new API key. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const rotateKey = async (keyToRotate: ApiKey) => {
    try {
      const { data, error } = await supabase.functions.invoke('rotate-api-key', {
        body: { key_id: keyToRotate.id }
      });

      if (error) throw error;
      if (!data?.key) throw new Error(data?.error || 'Failed to rotate API key');

      setFreshKey(data.key);
      await loadKeys();
      toast({
        title: "API Key Rotated",
        description: "Your new key is ready. The previous key keeps working for 24 hours so you can update your apps without downtime.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to rotate API key. Please try again.",
        variant: "destructive",
      });
    }
  };

  const revokeKey = async (keyToRevoke: ApiKey) => {
    try {
      const { data, error } = await supabase.functions.invoke('revoke-api-key', {
        body: { key_id: keyToRevoke.id }
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to revoke API key');

      const mark = (keys: ApiKey[]) => keys.map(key =>
        key.id === keyToRevoke.id ? { ...key, revoked: true } : key
      );
      if (keyToRevoke.environment === 'production') {
        setLiveKeys(mark);
      } else {
        setSandboxKeys(mark);
      }

      toast({
        title: "API Key Revoked",
        description: "The API key has been revoked successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to revoke API key. Please try again.",
        variant: "destructive",
      });
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: "API key copied to clipboard",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const renderKeySection = (environment: KeyEnvironment) => {
    const keys = environment === 'production' ? liveKeys : sandboxKeys;

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            {environment === 'production' ? 'Production' : 'Sandbox'} API Keys
            <Badge variant={environment === 'production' ? "default" : "secondary"}>
              {environment === 'production' ? 'Real money' : 'Simulated money'}
            </Badge>
          </h4>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateNewKey(environment)}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <RefreshCwIcon className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Generate New Key
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          {environment === 'production'
            ? "Production keys move real money. Keep them on your server only."
            : "Sandbox keys run the full API on mainnet formats with simulated money — build and test your integration here first. Nothing in the sandbox touches a real wallet."}
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-2">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No {environment} API keys yet — generate one to get started.
          </p>
        ) : keys.map((key) => {
          const inGrace = !key.revoked && key.graceUntil && new Date(key.graceUntil).getTime() > Date.now();
          return (
          <div
            key={key.id}
            className="flex flex-wrap justify-between items-center gap-2 p-3 bg-secondary/20 rounded-md"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
              {/* Only the prefix is stored; the full key exists only at creation time. */}
              <code className="font-mono bg-secondary px-3 py-1 rounded text-sm">
                {key.prefix}••••••••
              </code>
              {key.name && <span className="text-sm text-muted-foreground">{key.name}</span>}
              <span className="text-xs text-muted-foreground">Key ID: {key.id.slice(0, 8)}…</span>
              <Badge variant={key.revoked ? "destructive" : "default"}>
                {key.revoked ? "Revoked" : inGrace ? "Rotating" : "Active"}
              </Badge>
              {inGrace && (
                <span className="text-xs text-muted-foreground">
                  Previous key stops working {new Date(key.graceUntil!).toLocaleString()}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-1">
              {!key.revoked && (
                <Button variant="ghost" size="sm" onClick={() => rotateKey(key)} title="Rotate this key">
                  <RefreshCwIcon className="h-4 w-4" />
                </Button>
              )}
              {!key.revoked && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <TrashIcon className="h-4 w-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. The API key will stop working
                        immediately and any applications using it will be refused.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => revokeKey(key)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Revoke Key
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>
          Keep your API keys secure! Never share them in publicly accessible places such as GitHub or client-side code.
          A key's environment is set by the key itself — a sandbox key can never move real money, whatever a plugin or app asks for.
        </AlertDescription>
      </Alert>

      {freshKey && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertDescription className="space-y-2">
            <p className="font-medium">Copy your new API key now — it won't be shown again.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono bg-secondary px-3 py-1 rounded text-sm break-all">{freshKey}</code>
              <Button variant="outline" size="sm" onClick={() => copyToClipboard(freshKey)}>
                <CopyIcon className="h-4 w-4 mr-1" /> Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFreshKey(null)}>
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {renderKeySection('production')}
      {renderKeySection('sandbox')}

      <p className="text-sm text-muted-foreground">
        Connecting a shop or an app with these keys? The{" "}
        <Link className="underline" to="/developers/connectors">connectors directory</Link>{" "}
        lists the WooCommerce, Odoo, Magento, PrestaShop and OpenCart plugins, the
        embed button and the SDKs — all in the public BMaGlass Pay connectors
        repository on GitHub.
      </p>
    </div>
  );
}
