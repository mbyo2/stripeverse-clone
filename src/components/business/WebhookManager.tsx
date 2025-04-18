
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface WebhookConfig {
  url: string;
  events: {
    payment_success: boolean;
    payment_failed: boolean;
    settlement: boolean;
    refund: boolean;
  };
}

export function WebhookManager() {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState({
    payment_success: true,
    payment_failed: true,
    settlement: true,
    refund: true
  });

  const handleSave = async () => {
    if (!webhookUrl) {
      toast({
        title: "Error",
        description: "Please enter a webhook URL",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase.functions.invoke('update-webhook', {
        body: {
          url: webhookUrl,
          events: selectedEvents
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Webhook settings have been saved",
      });
    } catch (error) {
      console.error('Error saving webhook:', error);
      toast({
        title: "Error",
        description: "Failed to save webhook settings",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 border rounded-md">
      <h3 className="font-medium mb-3">Webhook Settings</h3>
      <div className="space-y-4">
        <div className="flex flex-col">
          <Label htmlFor="webhookUrl" className="mb-1">Webhook URL</Label>
          <div className="flex gap-2">
            <Input
              id="webhookUrl"
              placeholder="https://your-domain.com/webhook"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Event Notifications</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="payment_success"
                checked={selectedEvents.payment_success}
                onCheckedChange={(checked) => 
                  setSelectedEvents(prev => ({...prev, payment_success: checked as boolean}))
                }
              />
              <Label htmlFor="payment_success">Payment Success</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="payment_failed"
                checked={selectedEvents.payment_failed}
                onCheckedChange={(checked) => 
                  setSelectedEvents(prev => ({...prev, payment_failed: checked as boolean}))
                }
              />
              <Label htmlFor="payment_failed">Payment Failed</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="settlement"
                checked={selectedEvents.settlement}
                onCheckedChange={(checked) => 
                  setSelectedEvents(prev => ({...prev, settlement: checked as boolean}))
                }
              />
              <Label htmlFor="settlement">Settlement Complete</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="refund"
                checked={selectedEvents.refund}
                onCheckedChange={(checked) => 
                  setSelectedEvents(prev => ({...prev, refund: checked as boolean}))
                }
              />
              <Label htmlFor="refund">Refund Processed</Label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
