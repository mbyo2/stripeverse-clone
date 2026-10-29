import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useCardTokens } from '@/hooks/useCardTokens';
import { SavedCardSkeleton } from "@/components/ui/skeletons";
import { CreditCard, Plus, Star, Trash2, Shield, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const brandColors: Record<string, string> = {
  visa: 'bg-[#003087]',
  mastercard: 'bg-[#7A1E1E]',
  amex: 'bg-[#1F5C46]',
  discover: 'bg-[#9A6206]',
  unknown: 'bg-[#44464A]',
};

const CardVault = () => {
  const { tokens, isLoading, setDefault, removeToken } = useCardTokens();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 pt-6 pb-16">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold">Card Vault</h1>
            <p className="text-sm text-muted-foreground mt-1">Saved cards — adding new cards is currently disabled</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Card</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add a Card</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="p-3 bg-muted rounded-lg flex items-start gap-2 text-sm">
                  <Lock className="h-4 w-4 mt-0.5 text-primary" />
                  <span className="text-muted-foreground">Card storage is disabled until a PCI-compliant vault is connected. For your safety, this form does not collect card numbers.</span>
                </div>
                <Button disabled className="w-full">Add Card (not available yet)</Button>
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
                <p className="font-medium">Card Storage Is Disabled</p>
                <p className="text-muted-foreground">Card storage is disabled until a PCI-compliant vault is connected. Entries saved previously are shown below for reference only — they can't be used to make payments, and no new cards can be added.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="status" aria-label="Loading saved cards">
            <SavedCardSkeleton />
            <SavedCardSkeleton />
          </div>
        ) : tokens.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center py-12">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <CreditCard className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium mb-2">No Saved Cards</h3>
              <p className="text-muted-foreground text-sm mb-4">Card storage is disabled until a PCI-compliant vault is connected, so no cards can be added right now.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tokens.map(token => (
              <Card key={token.id} className="overflow-hidden">
                <div className={`${brandColors[token.card_brand] || brandColors.unknown} p-6 text-white`}>
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
