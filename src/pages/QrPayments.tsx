import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { QrCode, Download, Share2, Copy, ScanLine, Store, User, Smartphone, History, CheckCircle, ArrowRight } from 'lucide-react';
import QRCode from 'qrcode.react';

const QrPayments = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('ZMW');
  const [qrGenerated, setQrGenerated] = useState(false);
  const [qrType, setQrType] = useState<'personal' | 'merchant'>('personal');
  const [scanMode, setScanMode] = useState(false);

  const qrData = JSON.stringify({
    platform: 'bmaglass',
    version: '1.0',
    type: qrType === 'merchant' ? 'merchant_payment' : 'p2p_transfer',
    recipient: user?.id || '',
    amount: amount ? parseFloat(amount) : null,
    currency,
    description,
    timestamp: new Date().toISOString(),
  });

  const handleGenerate = () => {
    if (!amount && qrType === 'merchant') {
      toast({ title: 'Amount required', description: 'Enter an amount for merchant QR codes', variant: 'destructive' });
      return;
    }
    setQrGenerated(true);
    toast({ title: 'QR Code Generated', description: 'Share this code to receive payments' });
  };

  const handleDownload = () => {
    const canvas = document.querySelector('#qr-canvas canvas') as HTMLCanvasElement;
    if (canvas) {
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `bmaglass-qr-${Date.now()}.png`;
      link.href = url;
      link.click();
      toast({ title: 'Downloaded', description: 'QR code saved to your device' });
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'BMaGlass Payment QR', text: `Pay me via BMaGlass Pay${amount ? ` - ${currency} ${amount}` : ''}` });
    } else {
      await navigator.clipboard.writeText(qrData);
      toast({ title: 'Copied', description: 'Payment link copied to clipboard' });
    }
  };

  const recentQrPayments = [
    { id: 1, from: 'Mutale K.', amount: 150, currency: 'ZMW', time: '2 min ago', type: 'received' },
    { id: 2, from: 'Shop #247', amount: 89.50, currency: 'ZMW', time: '1 hr ago', type: 'paid' },
    { id: 3, from: 'Peter M.', amount: 500, currency: 'ZMW', time: '3 hrs ago', type: 'received' },
    { id: 4, from: 'Total Energies', amount: 320, currency: 'ZMW', time: 'Yesterday', type: 'paid' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">QR Code Payments</h1>
          <p className="text-muted-foreground mt-1">Generate, scan, and pay with QR codes instantly</p>
        </div>

        <Tabs defaultValue="generate" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="generate"><QrCode className="h-4 w-4 mr-2" />Generate</TabsTrigger>
            <TabsTrigger value="scan"><ScanLine className="h-4 w-4 mr-2" />Scan</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-2" />History</TabsTrigger>
          </TabsList>

          {/* GENERATE TAB */}
          <TabsContent value="generate">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Config */}
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Create QR Code</CardTitle>
                    <CardDescription>Choose a type and configure your payment QR</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => { setQrType('personal'); setQrGenerated(false); }}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${qrType === 'personal' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                      >
                        <User className="h-6 w-6" />
                        <span className="text-sm font-medium">Personal</span>
                        <span className="text-xs text-muted-foreground">P2P transfers</span>
                      </button>
                      <button
                        onClick={() => { setQrType('merchant'); setQrGenerated(false); }}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${qrType === 'merchant' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                      >
                        <Store className="h-6 w-6" />
                        <span className="text-sm font-medium">Merchant</span>
                        <span className="text-xs text-muted-foreground">Business payments</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Amount {qrType === 'personal' && <span className="text-muted-foreground">(optional)</span>}</Label>
                        <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Currency</Label>
                        <Select value={currency} onValueChange={setCurrency}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ZMW">ZMW</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
                      <Input placeholder="e.g. Coffee payment" value={description} onChange={e => setDescription(e.target.value)} />
                    </div>

                    <Button className="w-full" onClick={handleGenerate}>
                      <QrCode className="h-4 w-4 mr-2" /> Generate QR Code
                    </Button>
                  </CardContent>
                </Card>

                {/* Features */}
                <Card>
                  <CardContent className="p-5">
                    <h3 className="font-semibold mb-3 text-sm">QR Payment Features</h3>
                    <div className="space-y-2">
                      {[
                        { label: 'Dynamic QR', desc: 'Amount embedded in code' },
                        { label: 'Static QR', desc: 'Payer enters amount' },
                        { label: 'Multi-currency', desc: 'ZMW, USD, EUR, GBP' },
                        { label: 'Instant settlement', desc: 'Funds arrive immediately' },
                        { label: 'Works offline', desc: 'USSD fallback available' },
                      ].map(f => (
                        <div key={f.label} className="flex items-center gap-2 text-sm">
                          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          <span className="font-medium">{f.label}</span>
                          <span className="text-muted-foreground">— {f.desc}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* QR Preview */}
              <div className="space-y-6">
                <Card className="border-primary/20">
                  <CardContent className="p-8 flex flex-col items-center">
                    {qrGenerated ? (
                      <>
                        <div className="bg-white p-6 rounded-2xl shadow-sm mb-6" id="qr-canvas">
                          <QRCode value={qrData} size={220} level="H" includeMargin />
                        </div>
                        <div className="text-center mb-4">
                          {amount && <p className="text-2xl font-bold">{currency} {parseFloat(amount).toFixed(2)}</p>}
                          {description && <p className="text-muted-foreground text-sm mt-1">{description}</p>}
                          <Badge className="mt-2" variant="outline">{qrType === 'merchant' ? 'Merchant QR' : 'Personal QR'}</Badge>
                        </div>
                        <div className="flex gap-3">
                          <Button variant="outline" size="sm" onClick={handleDownload}><Download className="h-4 w-4 mr-1" />Download</Button>
                          <Button variant="outline" size="sm" onClick={handleShare}><Share2 className="h-4 w-4 mr-1" />Share</Button>
                          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(qrData); toast({ title: 'Copied' }); }}>
                            <Copy className="h-4 w-4 mr-1" />Copy
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-12">
                        <div className="w-20 h-20 bg-muted/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                          <QrCode className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <p className="text-muted-foreground">Configure and generate your QR code</p>
                        <p className="text-xs text-muted-foreground mt-1">It will appear here</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* SCAN TAB */}
          <TabsContent value="scan">
            <div className="max-w-lg mx-auto">
              <Card>
                <CardContent className="p-8 text-center">
                  <div className="w-64 h-64 bg-muted/30 border-2 border-dashed border-primary/30 rounded-2xl flex items-center justify-center mx-auto mb-6 relative overflow-hidden">
                    <div className="absolute inset-4 border-2 border-primary/40 rounded-xl" />
                    <ScanLine className="h-16 w-16 text-primary/50 animate-pulse" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Scan QR Code</h3>
                  <p className="text-sm text-muted-foreground mb-6">Point your camera at a BMaGlass QR code to make a payment</p>
                  <Button size="lg" className="w-full">
                    <Smartphone className="h-4 w-4 mr-2" /> Open Camera
                  </Button>
                  <p className="text-xs text-muted-foreground mt-3">Camera access requires a mobile device or webcam</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* HISTORY TAB */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">QR Payment History</CardTitle>
                <CardDescription>Recent payments made or received via QR code</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentQrPayments.map(p => (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${p.type === 'received' ? 'bg-green-500/10 text-green-600' : 'bg-orange-500/10 text-orange-600'}`}>
                          <QrCode className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{p.from}</p>
                          <p className="text-xs text-muted-foreground">{p.time}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold text-sm ${p.type === 'received' ? 'text-green-600' : 'text-foreground'}`}>
                          {p.type === 'received' ? '+' : '-'}{p.currency} {p.amount.toFixed(2)}
                        </p>
                        <Badge variant="outline" className="text-xs">{p.type}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default QrPayments;
