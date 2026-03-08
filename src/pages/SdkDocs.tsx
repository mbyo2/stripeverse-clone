import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Code2, Package, Terminal, Copy, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const sdks = [
  {
    lang: 'JavaScript / Node.js',
    package: 'npm install @bmaglasspay/sdk',
    badge: 'v2.1.0',
    init: `import BMaGlassPay from '@bmaglasspay/sdk';

const pay = new BMaGlassPay({
  apiKey: 'sk_live_your_key',
  environment: 'production', // or 'sandbox'
});`,
    charge: `const charge = await pay.charges.create({
  amount: 5000,
  currency: 'ZMW',
  email: 'customer@example.com',
  payment_method: 'mobile_money',
  mobile_money: {
    phone: '+260971234567',
    provider: 'mtn',
  },
});

console.log(charge.id, charge.status);`,
    webhook: `import { verifyWebhook } from '@bmaglasspay/sdk';

app.post('/webhook', (req, res) => {
  const event = verifyWebhook(req.body, req.headers['x-bmglass-signature'], webhookSecret);
  
  switch (event.type) {
    case 'charge.completed':
      // Handle successful payment
      break;
    case 'transfer.completed':
      // Handle completed transfer
      break;
  }
  res.sendStatus(200);
});`,
  },
  {
    lang: 'Python',
    package: 'pip install bmaglasspay',
    badge: 'v1.4.0',
    init: `import bmaglasspay

pay = bmaglasspay.Client(
    api_key="sk_live_your_key",
    environment="production"
)`,
    charge: `charge = pay.charges.create(
    amount=5000,
    currency="ZMW",
    email="customer@example.com",
    payment_method="mobile_money",
    mobile_money={
        "phone": "+260971234567",
        "provider": "mtn"
    }
)

print(charge.id, charge.status)`,
    webhook: `from bmaglasspay import verify_webhook

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    event = verify_webhook(
        request.data,
        request.headers['X-BMGlass-Signature'],
        webhook_secret
    )
    
    if event['type'] == 'charge.completed':
        # Handle successful payment
        pass
    
    return '', 200`,
  },
  {
    lang: 'PHP',
    package: 'composer require bmaglasspay/sdk',
    badge: 'v1.2.0',
    init: `<?php
use BMaGlassPay\\Client;

$pay = new Client([
    'api_key' => 'sk_live_your_key',
    'environment' => 'production',
]);`,
    charge: `$charge = $pay->charges->create([
    'amount' => 5000,
    'currency' => 'ZMW',
    'email' => 'customer@example.com',
    'payment_method' => 'mobile_money',
    'mobile_money' => [
        'phone' => '+260971234567',
        'provider' => 'mtn',
    ],
]);

echo $charge->id . ' ' . $charge->status;`,
    webhook: `$event = \\BMaGlassPay\\Webhook::verify(
    file_get_contents('php://input'),
    $_SERVER['HTTP_X_BMGLASS_SIGNATURE'],
    $webhook_secret
);

switch ($event->type) {
    case 'charge.completed':
        // Handle successful payment
        break;
}

http_response_code(200);`,
  },
  {
    lang: 'Go',
    package: 'go get github.com/bmaglasspay/go-sdk',
    badge: 'v0.9.0',
    init: `import "github.com/bmaglasspay/go-sdk"

client := bmaglasspay.NewClient("sk_live_your_key",
    bmaglasspay.WithEnvironment("production"),
)`,
    charge: `charge, err := client.Charges.Create(&bmaglasspay.ChargeParams{
    Amount:        5000,
    Currency:      "ZMW",
    Email:         "customer@example.com",
    PaymentMethod: "mobile_money",
    MobileMoney: &bmaglasspay.MobileMoneyParams{
        Phone:    "+260971234567",
        Provider: "mtn",
    },
})

fmt.Println(charge.ID, charge.Status)`,
    webhook: `func webhookHandler(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    sig := r.Header.Get("X-BMGlass-Signature")
    
    event, err := bmaglasspay.VerifyWebhook(body, sig, webhookSecret)
    if err != nil {
        http.Error(w, "Invalid", 400)
        return
    }
    
    switch event.Type {
    case "charge.completed":
        // Handle payment
    }
    w.WriteHeader(200)
}`,
  },
];

const CopyBlock = ({ code }: { code: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="bg-muted rounded-lg p-4 text-sm overflow-x-auto"><code>{code}</code></pre>
      <Button
        variant="ghost" size="icon"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 h-7 w-7"
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      >
        {copied ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
};

const SdkDocs = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-5xl mt-14">
        <div className="mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Package className="h-6 w-6" />SDK Documentation</h1>
          <p className="text-muted-foreground mt-1">Official client libraries for every major platform</p>
        </div>

        <Tabs defaultValue="JavaScript / Node.js">
          <TabsList className="flex-wrap h-auto gap-1">
            {sdks.map(s => (
              <TabsTrigger key={s.lang} value={s.lang} className="text-xs">{s.lang}</TabsTrigger>
            ))}
          </TabsList>

          {sdks.map(sdk => (
            <TabsContent key={sdk.lang} value={sdk.lang} className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2"><Code2 className="h-5 w-5" />{sdk.lang} SDK</CardTitle>
                    <Badge variant="secondary">{sdk.badge}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <h3 className="font-medium mb-2 flex items-center gap-2"><Terminal className="h-4 w-4" />Installation</h3>
                    <CopyBlock code={sdk.package} />
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">Initialization</h3>
                    <CopyBlock code={sdk.init} />
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">Create a Charge</h3>
                    <CopyBlock code={sdk.charge} />
                  </div>
                  <div>
                    <h3 className="font-medium mb-2">Webhook Verification</h3>
                    <CopyBlock code={sdk.webhook} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default SdkDocs;
