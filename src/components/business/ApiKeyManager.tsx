
import { useState } from "react";
import { CopyIcon, EyeIcon, EyeOffIcon, RefreshCwIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ApiKey {
  id: string;
  prefix: string;
  lastFour: string;
  createdAt: string;
  type: 'test' | 'live';
  revoked?: boolean;
}

export function ApiKeyManager() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showLiveKey, setShowLiveKey] = useState(false);
  const [showTestKey, setShowTestKey] = useState(false);
  const { toast } = useToast();
  const [liveKeys, setLiveKeys] = useState<ApiKey[]>([{
    id: "live_key",
    prefix: "bmp_live_",
    lastFour: "x4k9",
    createdAt: new Date().toISOString(),
    type: 'live'
  }]);
  const [testKeys, setTestKeys] = useState<ApiKey[]>([{
    id: "test_key",
    prefix: "bmp_test_",
    lastFour: "t3s7",
    createdAt: new Date().toISOString(),
    type: 'test'
  }]);

  const generateNewKey = async (type: 'test' | 'live') => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-api-key', {
        body: { type }
      });
      
      if (error) throw error;
      
      if (type === 'live') {
        setLiveKeys([...liveKeys, data]);
      } else {
        setTestKeys([...testKeys, data]);
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
      if (keyToRevoke.type === 'live') {
        setLiveKeys(liveKeys.map(key => 
          key.id === keyToRevoke.id ? { ...key, revoked: true } : key
        ));
      } else {
        setTestKeys(testKeys.map(key => 
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

  const copyToClipboard = async (text: string, keyType: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${keyType} key copied to clipboard`,
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
    const showKey = type === 'live' ? showLiveKey : showTestKey;
    const setShowKey = type === 'live' ? setShowLiveKey : setShowTestKey;

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
              <RefreshIcon className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Generate New Key
          </Button>
        </div>

        {keys.map((key) => (
          <div
            key={key.id}
            className="flex justify-between items-center p-3 bg-secondary/20 rounded-md"
          >
            <div className="flex items-center space-x-3">
              <code className="font-mono bg-secondary px-3 py-1 rounded text-sm">
                {showKey ? `${key.prefix}...${key.lastFour}` : '••••••••••••••••'}
              </code>
              <Badge variant={key.revoked ? "destructive" : "default"}>
                {key.revoked ? "Revoked" : "Active"}
              </Badge>
            </div>
            
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? (
                  <EyeOffIcon className="h-4 w-4" />
                ) : (
                  <EyeIcon className="h-4 w-4" />
                )}
              </Button>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(`${key.prefix}...${key.lastFour}`, type)}
              >
                <CopyIcon className="h-4 w-4" />
              </Button>

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

      {renderKeySection('live')}
      {renderKeySection('test')}
    </div>
  );
}
