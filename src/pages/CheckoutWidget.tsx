import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useToast } from '@/hooks/use-toast';
import { Code2, Copy, Eye, Palette, CreditCard, Smartphone, Zap, CheckCircle, Settings, ExternalLink } from 'lucide-react';

const CheckoutWidget = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState({
    publicKey: 'pk_test_xxxxxxxxxxxxxxxx',
    amount: '100.00',
    currency: 'ZMW',
    title: 'My Store',
    description: 'Payment for order',
    logo: '',
    primaryColor: '#2563eb',
    showMobileMoney: true,
    showCard: true,
    showBankTransfer: true,
    showBitcoin: false,
    callbackUrl: 'https://yoursite.com/callback',
    redirectUrl: 'https://yoursite.com/success',
    theme: 'default',
  });

  const updateConfig = (key: string, value: any) => setConfig(prev => ({ ...prev, [key]: value }));

  const jsSnippet = `<script src="https://js.bmaglasspay.com/v1/checkout.js"></script>
<script>
  const checkout = BMaGlassPay.checkout({
    publicKey: "${config.publicKey}",
    amount: ${config.amount},
    currency: "${config.currency}",
    title: "${config.title}",
    description: "${config.description}",
    ${config.logo ? `logo: "${config.logo}",` : ''}
    theme: {
      primaryColor: "${config.primaryColor}",
    },
    paymentMethods: [${[
      config.showCard && '"card"',
      config.showMobileMoney && '"mobile_money"',
      config.showBankTransfer && '"bank_transfer"',
      config.showBitcoin && '"bitcoin"',
    ].filter(Boolean).join(', ')}],
    callbackUrl: "${config.callbackUrl}",
    onSuccess: function(response) {
      console.log("Payment successful:", response);
      window.location.href = "${config.redirectUrl}";
    },
    onError: function(error) {
      console.error("Payment failed:", error);
    },
    onClose: function() {
      console.log("Checkout closed");
    }
  });

  // Open checkout modal
  document.getElementById("pay-btn").addEventListener("click", () => {
    checkout.open();
  });
</script>

<button id="pay-btn">Pay ${config.currency} ${config.amount}</button>`;

  const reactSnippet = `import { BMaGlassCheckout } from '@bmaglass/react-checkout';

function PaymentPage() {
  return (
    <BMaGlassCheckout
      publicKey="${config.publicKey}"
      amount={${config.amount}}
      currency="${config.currency}"
      title="${config.title}"
      description="${config.description}"
      paymentMethods={[${[
        config.showCard && '"card"',
        config.showMobileMoney && '"mobile_money"',
        config.showBankTransfer && '"bank_transfer"',
        config.showBitcoin && '"bitcoin"',
      ].filter(Boolean).join(', ')}]}
      theme={{ primaryColor: "${config.primaryColor}" }}
      onSuccess={(response) => {
        console.log("Payment successful:", response);
      }}
      onError={(error) => {
        console.error("Payment failed:", error);
      }}
    >
      <button>Pay ${config.currency} ${config.amount}</button>
    </BMaGlassCheckout>
  );
}`;

  const htmlSnippet = `<!-- BMaGlass Pay Button — paste in your HTML -->
<form action="https://api.bmaglasspay.com/v1/checkout/hosted" method="POST">
  <input type="hidden" name="public_key" value="${config.publicKey}" />
  <input type="hidden" name="amount" value="${config.amount}" />
  <input type="hidden" name="currency" value="${config.currency}" />
  <input type="hidden" name="title" value="${config.title}" />
  <input type="hidden" name="redirect_url" value="${config.redirectUrl}" />
  <input type="hidden" name="callback_url" value="${config.callbackUrl}" />
  <button type="submit" style="
    background: ${config.primaryColor};
    color: white;
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
  ">Pay ${config.currency} ${config.amount}</button>
</form>`;

  const copyCode = (code: string, label: string) => {
    navigator.clipboard.writeText(code);
    toast({ title: 'Copied!', description: `${label} code copied to clipboard` });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Checkout Widget Builder</h1>
          <p className="text-muted-foreground mt-1">Generate embeddable payment forms for your website</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Configuration */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Settings className="h-5 w-5" /> Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Public Key</Label>
                  <Input value={config.publicKey} onChange={e => updateConfig('publicKey', e.target.value)} placeholder="pk_test_..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input type="number" value={config.amount} onChange={e => updateConfig('amount', e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select value={config.currency} onValueChange={v => updateConfig('currency', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ZMW">ZMW</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                        <SelectItem value="NGN">NGN</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input value={config.title} onChange={e => updateConfig('title', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={config.description} onChange={e => updateConfig('description', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Brand Color</Label>
                  <div className="flex gap-2">
                    <input type="color" value={config.primaryColor} onChange={e => updateConfig('primaryColor', e.target.value)} className="w-10 h-10 rounded border cursor-pointer" />
                    <Input value={config.primaryColor} onChange={e => updateConfig('primaryColor', e.target.value)} className="flex-1" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><CreditCard className="h-5 w-5" /> Payment Methods</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { key: 'showCard', label: 'Card (Visa/Mastercard)', icon: '💳' },
                  { key: 'showMobileMoney', label: 'Mobile Money', icon: '📱' },
                  { key: 'showBankTransfer', label: 'Bank Transfer', icon: '🏦' },
                  { key: 'showBitcoin', label: 'Bitcoin', icon: '₿' },
                ].map(m => (
                  <div key={m.key} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span>{m.icon}</span>
                      <span>{m.label}</span>
                    </div>
                    <Switch checked={(config as any)[m.key]} onCheckedChange={v => updateConfig(m.key, v)} />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Webhook & Redirect</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Callback URL</Label>
                  <Input value={config.callbackUrl} onChange={e => updateConfig('callbackUrl', e.target.value)} placeholder="https://..." />
                </div>
                <div className="space-y-2">
                  <Label>Redirect URL</Label>
                  <Input value={config.redirectUrl} onChange={e => updateConfig('redirectUrl', e.target.value)} placeholder="https://..." />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Code Output */}
          <div className="lg:col-span-2 space-y-6">
            {/* Preview */}
            <Card className="border-primary/20">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Eye className="h-5 w-5" /> Live Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/30 rounded-xl p-6 flex items-center justify-center min-h-[280px]">
                  <div className="bg-background rounded-2xl shadow-lg border p-6 w-full max-w-sm">
                    <div className="text-center mb-4">
                      <h3 className="font-semibold text-lg">{config.title}</h3>
                      <p className="text-sm text-muted-foreground">{config.description}</p>
                      <p className="text-3xl font-bold mt-2" style={{ color: config.primaryColor }}>
                        {config.currency} {parseFloat(config.amount || '0').toFixed(2)}
                      </p>
                    </div>
                    <div className="space-y-2 mb-4">
                      {config.showCard && (
                        <div className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary/40 cursor-pointer transition-colors">
                          <CreditCard className="h-4 w-4" /><span className="text-sm">Card Payment</span>
                          <Badge variant="outline" className="ml-auto text-xs">Visa/MC</Badge>
                        </div>
                      )}
                      {config.showMobileMoney && (
                        <div className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary/40 cursor-pointer transition-colors">
                          <Smartphone className="h-4 w-4" /><span className="text-sm">Mobile Money</span>
                          <Badge variant="outline" className="ml-auto text-xs">MTN/Airtel</Badge>
                        </div>
                      )}
                      {config.showBankTransfer && (
                        <div className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary/40 cursor-pointer transition-colors">
                          <span className="text-sm">🏦</span><span className="text-sm">Bank Transfer</span>
                        </div>
                      )}
                      {config.showBitcoin && (
                        <div className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary/40 cursor-pointer transition-colors">
                          <Zap className="h-4 w-4" /><span className="text-sm">Bitcoin</span>
                        </div>
                      )}
                    </div>
                    <Button className="w-full" style={{ backgroundColor: config.primaryColor }}>
                      Pay {config.currency} {parseFloat(config.amount || '0').toFixed(2)}
                    </Button>
                    <p className="text-center text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Secured by BMaGlass Pay
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Code Snippets */}
            <Tabs defaultValue="js">
              <TabsList>
                <TabsTrigger value="js">JavaScript</TabsTrigger>
                <TabsTrigger value="react">React</TabsTrigger>
                <TabsTrigger value="html">HTML Form</TabsTrigger>
              </TabsList>
              {[
                { key: 'js', code: jsSnippet, label: 'JavaScript' },
                { key: 'react', code: reactSnippet, label: 'React' },
                { key: 'html', code: htmlSnippet, label: 'HTML' },
              ].map(tab => (
                <TabsContent key={tab.key} value={tab.key}>
                  <Card>
                    <CardContent className="p-0">
                      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                        <span className="text-sm font-medium">{tab.label}</span>
                        <Button variant="ghost" size="sm" onClick={() => copyCode(tab.code, tab.label)}>
                          <Copy className="h-4 w-4 mr-1" /> Copy
                        </Button>
                      </div>
                      <pre className="p-4 text-xs font-mono overflow-x-auto max-h-96 bg-muted/10">
                        <code>{tab.code}</code>
                      </pre>
                    </CardContent>
                  </Card>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default CheckoutWidget;
