import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Settings, Shield, Globe } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface CardProcessorConfig {
  provider: 'mastercard' | 'adyen' | 'local';
  apiKey: string;
  environment: 'sandbox' | 'production';
  webhookUrl: string;
  merchantId?: string;
  features: string[];
}

interface CardProcessorIntegrationProps {
  onConfigSave: (config: CardProcessorConfig) => void;
}

const CardProcessorIntegration: React.FC<CardProcessorIntegrationProps> = ({ onConfigSave }) => {
  const [config, setConfig] = useState<CardProcessorConfig>({
    provider: 'local',
    apiKey: '',
    environment: 'sandbox',
    webhookUrl: '',
    merchantId: '',
    features: ['basic_payments']
  });
  const [isValidating, setIsValidating] = useState(false);
  const { toast } = useToast();

  const providerFeatures = {
    mastercard: ['basic_payments', '3ds_auth', 'tokenization', 'recurring', 'refunds'],
    adyen: ['basic_payments', '3ds_auth', 'tokenization', 'recurring', 'refunds', 'fraud_detection'],
    local: ['basic_payments', 'tokenization']
  };

  const handleValidateConfig = async () => {
    if (!config.apiKey.trim()) {
      toast({
        title: 'Validation Error',
        description: 'API Key is required',
        variant: 'destructive'
      });
      return;
    }

    setIsValidating(true);
    
    try {
      // Simulate API validation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      toast({
        title: 'Configuration Valid',
        description: `${config.provider} integration configured successfully`,
      });
      
      onConfigSave(config);
    } catch (error) {
      toast({
        title: 'Validation Failed',
        description: 'Could not validate the provided configuration',
        variant: 'destructive'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const getProviderInfo = () => {
    switch (config.provider) {
      case 'mastercard':
        return {
          name: 'Mastercard Send API',
          description: 'Official Mastercard payment processing',
          icon: <CreditCard className="h-5 w-5 text-red-600" />,
          docs: 'https://developer.mastercard.com/send'
        };
      case 'adyen':
        return {
          name: 'Adyen Payment Platform',
          description: 'Global payment processing with advanced features',
          icon: <Globe className="h-5 w-5 text-green-600" />,
          docs: 'https://docs.adyen.com'
        };
      default:
        return {
          name: 'Local Processor',
          description: 'Basic card processing for development',
          icon: <Settings className="h-5 w-5 text-gray-600" />,
          docs: '#'
        };
    }
  };

  const providerInfo = getProviderInfo();

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Card Processor Integration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Provider Selection */}
        <div className="space-y-3">
          <Label>Payment Processor</Label>
          <Select 
            value={config.provider} 
            onValueChange={(value: 'mastercard' | 'adyen' | 'local') => 
              setConfig(prev => ({ 
                ...prev, 
                provider: value, 
                features: providerFeatures[value] 
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mastercard">Mastercard Send API</SelectItem>
              <SelectItem value="adyen">Adyen Payment Platform</SelectItem>
              <SelectItem value="local">Local Processor (Development)</SelectItem>
            </SelectContent>
          </Select>
          
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            {providerInfo.icon}
            <div>
              <div className="font-medium">{providerInfo.name}</div>
              <div className="text-sm text-muted-foreground">{providerInfo.description}</div>
            </div>
          </div>
        </div>

        {/* API Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="Enter your API key"
              value={config.apiKey}
              onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Environment</Label>
            <Select 
              value={config.environment} 
              onValueChange={(value: 'sandbox' | 'production') => 
                setConfig(prev => ({ ...prev, environment: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {config.provider !== 'local' && (
          <div className="space-y-2">
            <Label htmlFor="merchantId">Merchant ID</Label>
            <Input
              id="merchantId"
              placeholder="Enter your merchant ID"
              value={config.merchantId}
              onChange={(e) => setConfig(prev => ({ ...prev, merchantId: e.target.value }))}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="webhookUrl">Webhook URL</Label>
          <Input
            id="webhookUrl"
            placeholder="https://your-app.com/webhooks/payments"
            value={config.webhookUrl}
            onChange={(e) => setConfig(prev => ({ ...prev, webhookUrl: e.target.value }))}
          />
        </div>

        {/* Features */}
        <div className="space-y-3">
          <Label>Available Features</Label>
          <div className="flex flex-wrap gap-2">
            {config.features.map((feature) => (
              <Badge key={feature} variant="secondary">
                {feature.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </Badge>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4">
          <Button 
            variant="outline" 
            onClick={() => window.open(providerInfo.docs, '_blank')}
          >
            View Documentation
          </Button>
          
          <Button 
            onClick={handleValidateConfig}
            disabled={isValidating || !config.apiKey.trim()}
          >
            {isValidating ? 'Validating...' : 'Save Configuration'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CardProcessorIntegration;