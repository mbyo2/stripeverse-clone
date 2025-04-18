
import { useState } from "react";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ApiKey {
  id: string;
  prefix: string;
  lastFour: string;
  createdAt: string;
  type: 'test' | 'live';
}

export function ApiKeyManager() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showLiveKey, setShowLiveKey] = useState(false);
  const [showTestKey, setShowTestKey] = useState(false);
  const { toast } = useToast();
  const [liveKey, setLiveKey] = useState<ApiKey>({
    id: "live_key",
    prefix: "bmp_live_",
    lastFour: "x4k9",
    createdAt: new Date().toISOString(),
    type: 'live'
  });
  const [testKey, setTestKey] = useState<ApiKey>({
    id: "test_key",
    prefix: "bmp_test_",
    lastFour: "t3s7",
    createdAt: new Date().toISOString(),
    type: 'test'
  });

  const generateNewKey = async (type: 'test' | 'live') => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-api-key', {
        body: { type }
      });
      
      if (error) throw error;
      
      toast({
        title: "API Key Generated",
        description: `Your new ${type} API key has been generated successfully.`,
      });

      if (type === 'live') {
        setLiveKey(data);
      } else {
        setTestKey(data);
      }
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

  return (
    <div className="space-y-6">
      <div className="p-4 border rounded-md">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-medium">API Keys</h3>
          <div className="space-x-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => generateNewKey('test')}
              disabled={isGenerating}
            >
              Generate Test Key
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => generateNewKey('live')}
              disabled={isGenerating}
            >
              Generate Live Key
            </Button>
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="flex justify-between items-center p-3 bg-secondary/20 rounded-md">
            <div>
              <p className="font-medium">Live API Key</p>
              <p className="text-sm text-muted-foreground">Use for production transactions</p>
            </div>
            <div className="flex items-center space-x-2">
              <code className="font-mono bg-secondary px-3 py-1 rounded">
                {showLiveKey 
                  ? `${liveKey.prefix}...${liveKey.lastFour}`
                  : '••••••••••••••••'}
              </code>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowLiveKey(!showLiveKey)}
              >
                {showLiveKey ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(`${liveKey.prefix}...${liveKey.lastFour}`, 'Live')}
              >
                <CopyIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex justify-between items-center p-3 bg-secondary/20 rounded-md">
            <div>
              <p className="font-medium">Test API Key</p>
              <p className="text-sm text-muted-foreground">Use for testing integration</p>
            </div>
            <div className="flex items-center space-x-2">
              <code className="font-mono bg-secondary px-3 py-1 rounded">
                {showTestKey 
                  ? `${testKey.prefix}...${testKey.lastFour}`
                  : '••••••••••••••••'}
              </code>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowTestKey(!showTestKey)}
              >
                {showTestKey ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(`${testKey.prefix}...${testKey.lastFour}`, 'Test')}
              >
                <CopyIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
