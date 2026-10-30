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

interface ApiKey {
  id: string;
  name: string | null;
  prefix: string;
  createdAt: string;
  type: 'test' | 'live';
  revoked?: boolean;
}

interface ApiKeyRow {
  id: string;
  name: string | null;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
}

export function ApiKeyManager() {
  const { user } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [liveKeys, setLiveKeys] = useState<ApiKey[]>([]);
  const [testKeys, setTestKeys] = useState<ApiKey[]>([]);
  // A newly generated key is shown in full exactly once — only its hash is
  // stored server-side, so it can never be retrieved again.
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const { toast } = useToast();

  const loadKeys = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, is_active, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({
        title: "Failed to load API keys",
        description: toUserFacingError(error),
        variant: "destructive",
      });
    } else {
      const rows = (data || []) as ApiKeyRow[];
      const mapped: ApiKey[] = rows.map(row => ({
        id: row.id,
        name: row.name,
        prefix: row.key_prefix,
        createdAt: row.created_at,
        type: row.key_prefix.includes('test') ? 'test' : 'live',
        revoked: !row.is_active,
      }));
      setLiveKeys(mapped.filter(k => k.type === 'live'));
      setTestKeys(mapped.filter(k => k.type === 'test'));
    }
    setIsLoading(false);
  }, [user, toast]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const generateNewKey = async (type: 'test' | 'live') => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-api-key', {
        body: { type }
      });

      if (error) throw error;

      const newKey: ApiKey = {
        id: data.id,
        name: data.name ?? null,
        prefix: data.key_prefix,
        createdAt: data.created_at,
        type: data.type === 'test' ? 'test' : 'live',
        revoked: false,
      };

      if (newKey.type === 'live') {
        setLiveKeys(prev => [newKey, ...prev]);
      } else {
        setTestKeys(prev => [newKey, ...prev]);
      }

      if (data.key) {
        setFreshKey(data.key);
      }

      toast({
        title: "New API Key Generated",
        description: `Your new ${type} API key has been generated successfully.`,
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

  const revokeKey = async (keyToRevoke: ApiKey) => {
    try {
      const { data, error } = await supabase.functions.invoke('revoke-api-key', {
        body: { key_id: keyToRevoke.id }
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Failed to revoke API key');

      if (keyToRevoke.type === 'live') {
        setLiveKeys(prev => prev.map(key =>
          key.id === keyToRevoke.id ? { ...key, revoked: true } : key
        ));
      } else {
        setTestKeys(prev => prev.map(key =>
          key.id === keyToRevoke.id ? { ...key, revoked: true } : key
        ));
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

  const renderKeySection = (type: 'live' | 'test') => {
    const keys = type === 'live' ? liveKeys : testKeys;

    return (
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h4 className="text-sm font-medium">{type === 'live' ? 'Live' : 'Test'} API Keys</h4>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generateNewKey(type)}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <RefreshCwIcon className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Generate New Key
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-2">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No {type} API keys yet — generate one to get started.
          </p>
        ) : keys.map((key) => (
          <div
            key={key.id}
            className="flex justify-between items-center p-3 bg-secondary/20 rounded-md"
          >
            <div className="flex items-center space-x-3">
              {/* Only the prefix is stored; the full key exists only at creation time. */}
              <code className="font-mono bg-secondary px-3 py-1 rounded text-sm">
                {key.prefix}••••••••
              </code>
              {key.name && <span className="text-sm text-muted-foreground">{key.name}</span>}
              <Badge variant={key.revoked ? "destructive" : "default"}>
                {key.revoked ? "Revoked" : "Active"}
              </Badge>
            </div>

            <div className="flex items-center space-x-2">
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
                        This action cannot be undone. The API key will be immediately revoked and any
                        applications using it will stop working.
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
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription>
          Keep your API keys secure! Never share them in publicly accessible places such as GitHub or client-side code.
        </AlertDescription>
      </Alert>

      {freshKey && (
        <Alert className="border-amber-500/50 bg-amber-500/10">
          <AlertDescription className="space-y-2">
            <p className="font-medium">Copy your new API key now — it won't be shown again.</p>
            <div className="flex items-center gap-2">
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

      {renderKeySection('live')}
      {renderKeySection('test')}

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
