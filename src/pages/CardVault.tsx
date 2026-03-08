import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useCardTokens } from '@/hooks/useCardTokens';
import { CreditCard, Plus, Star, Trash2, Shield, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const brandColors: Record<string, string> = {
  visa: 'from-blue-600 to-blue-800',
  mastercard: 'from-red-500 to-orange-500',
  amex: 'from-green-600 to-green-800',
  discover: 'from-orange-500 to-yellow-500',
  unknown: 'from-gray-600 to-gray-800',
};

const CardVault = () => {
  const { tokens, isLoading, tokenizeCard, setDefault, removeToken } = useCardTokens();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ number: '', exp: '', name: '' });

  const handleAdd = () => {
    const [month, year] = form.exp.split('/');
    if (!form.number || !month || !year) {
      toast({ title: 'Fill all fields', variant: 'destructive' });
      return;
    }
    tokenizeCard.mutate({
      card_number: form.number,
      exp_month: parseInt(month),
      exp_year: parseInt('20' + year),
      cardholder_name: form.name || undefined,
    }, {
      onSuccess: () => {
        setOpen(false);
        setForm({ number: '', exp: '', name: '' });
      },
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-4xl mt-14">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-6 w-6" />Card Vault</h1>
            <p className="text-muted-foreground">PCI-compliant tokenized card storage</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Card</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Tokenize a New Card</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-lg flex items-start gap-2 text-sm">
                  <Lock className="h-4 w-4 mt-0.5 text-primary" />
                  <span className="text-muted-foreground">Card numbers are tokenized immediately. The raw number is never stored.</span>
                </div>
                <div>
                  <Label>Cardholder Name</Label>
                  <Input placeholder="John Doe" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <Label>Card Number</Label>
                  <Input placeholder="4242 4242 4242 4242" value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} />
                </div>
                <div>
                  <Label>Expiry (MM/YY)</Label>
                  <Input placeholder="12/28" value={form.exp} onChange={e => setForm(f => ({ ...f, exp: e.target.value }))} />
                </div>
                <Button onClick={handleAdd} disabled={tokenizeCard.isPending} className="w-full">
                  {tokenizeCard.isPending ? 'Tokenizing...' : 'Tokenize & Save'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Security Banner */}
        <Card className="mb-6 border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Shield className="h-5 w-5 text-primary mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">PCI DSS Level 1 Compliant Tokenization</p>
                <p className="text-muted-foreground">Card details are replaced with secure tokens. Raw PANs are never stored in our database. Each token is unique and can only be used within your account.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : tokens.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center py-12">
              <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">No Saved Cards</h3>
              <p className="text-muted-foreground text-sm mb-4">Add a card to securely store it as a token for faster payments.</p>
              <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Your First Card</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tokens.map(token => (
              <Card key={token.id} className="overflow-hidden">
                <div className={`bg-gradient-to-r ${brandColors[token.card_brand] || brandColors.unknown} p-6 text-white`}>
                  <div className="flex items-center justify-between mb-8">
                    <span className="text-sm font-medium uppercase">{token.card_brand}</span>
                    {token.is_default && <Badge className="bg-white/20 text-white border-0">Default</Badge>}
                  </div>
                  <p className="text-lg tracking-[0.25em] font-mono mb-4">•••• •••• •••• {token.card_last_four}</p>
                  <div className="flex items-center justify-between text-sm">
                    <span>{token.cardholder_name || 'Card Holder'}</span>
                    <span>{String(token.card_exp_month).padStart(2, '0')}/{String(token.card_exp_year).slice(-2)}</span>
                  </div>
                </div>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-mono">Token: {token.token.slice(0, 16)}...</p>
                    <div className="flex gap-1">
                      {!token.is_default && (
                        <Button variant="ghost" size="sm" onClick={() => setDefault.mutate(token.id)}>
                          <Star className="h-3.5 w-3.5 mr-1" />Set Default
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeToken.mutate(token.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default CardVault;
