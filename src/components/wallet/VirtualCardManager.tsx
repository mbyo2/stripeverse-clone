
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@/hooks/useWallet";
import { formatCurrency } from "@/utils/walletUtils";
import { formatCardExpiry } from "@/utils/cardDisplay";

interface VirtualCardManagerProps {
  maxCards?: number;
}

const VirtualCardManager = ({ maxCards = 5 }: VirtualCardManagerProps) => {
  const navigate = useNavigate();
  const { virtualCards, createVirtualCard, isCreatingCard } = useWallet();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCardData, setNewCardData] = useState({
    name: '',
    initialBalance: 100,
    provider: 'bmaglass',
    cardType: 'debit'
  });
  const [visibleCards, setVisibleCards] = useState<Set<string>>(new Set());
  const [cardTokens, setCardTokens] = useState<Map<string, string>>(new Map());

  const handleCreateCard = () => {
    // Clear any sensitive data from memory after creation
    const sanitizedData = { ...newCardData };
    createVirtualCard(sanitizedData);
    setShowCreateDialog(false);
    // Clear form data
    setNewCardData({
      name: '',
      initialBalance: 100,
      provider: 'bmaglass',
      cardType: 'debit'
    });
  };

  const toggleCardVisibility = (cardId: string) => {
    const newVisible = new Set(visibleCards);
    if (newVisible.has(cardId)) {
      newVisible.delete(cardId);
      // Clear sensitive data from memory when hiding
      const newTokens = new Map(cardTokens);
      newTokens.delete(cardId);
      setCardTokens(newTokens);
    } else {
      newVisible.add(cardId);
    }
    setVisibleCards(newVisible);
  };

  // Card display — only the masked number exists. The full number is
  // never stored (the live table has no card_number column), so there
  // is no unmasked form to fall back to.
  const getSecureCardDisplay = (card: any) => {
    return card.masked_number;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center text-lg">
            <CreditCard className="mr-2 h-5 w-5" />
            Virtual Cards ({virtualCards.length}/{maxCards})
          </CardTitle>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button 
                size="sm" 
                disabled={virtualCards.length >= maxCards}
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Card
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Virtual Card</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="cardName">Card Name</Label>
                  <Input
                    id="cardName"
                    placeholder="e.g., Shopping Card"
                    value={newCardData.name}
                    onChange={(e) => setNewCardData({ ...newCardData, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="initialBalance">Initial Balance</Label>
                  <Input
                    id="initialBalance"
                    type="number"
                    min="0"
                    value={newCardData.initialBalance}
                    onChange={(e) => setNewCardData({ ...newCardData, initialBalance: Number(e.target.value) })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Provider</Label>
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-primary" />
                          <span className="font-medium">BMaGlass Virtual Card</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Internal wallet card — not a card-network or bank card
                        </p>
                      </div>
                    </div>
                  <div>
                    <Label>Type</Label>
                    <Select 
                      value={newCardData.cardType} 
                      onValueChange={(value) => setNewCardData({ ...newCardData, cardType: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="debit">Debit</SelectItem>
                        <SelectItem value="prepaid">Prepaid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button 
                  onClick={handleCreateCard} 
                  disabled={!newCardData.name || isCreatingCard}
                  className="w-full"
                >
                  {isCreatingCard ? "Creating..." : "Create Card"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {virtualCards.length === 0 ? (
          <div className="text-center py-8">
            <CreditCard className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Virtual Cards Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first virtual card to set money aside in a separate balance inside your wallet.
            </p>
            <Button 
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Card
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {virtualCards.map((card) => (
              <div key={card.id} className="bg-[#003087] rounded-2xl p-4 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">{card.name}</h3>
                      <p className="text-sm opacity-80 capitalize">BMaGlass {card.card_type} card</p>
                    </div>
                    <Badge variant={card.status === 'active' ? 'default' : 'secondary'}>
                      {card.status}
                    </Badge>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-lg">
                        {getSecureCardDisplay(card)}
                      </span>
                    </div>
                    <div className="flex justify-between mt-2 text-sm">
                      <span>CVV: ***</span>
                      <span>Exp: {formatCardExpiry(card.expiry_date)}</span>
                    </div>
                    <div className="mt-1">
                      <p className="text-xs opacity-60">
                        Full details, where kept, are shown on the card page after you confirm your password.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm opacity-80">Balance</p>
                      <p className="text-xl font-bold">{formatCurrency(card.balance)}</p>
                    </div>
                    <div className="flex space-x-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-white hover:bg-white/20"
                        onClick={() => navigate(`/card/${card.id}`)}
                      >
                        Details
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VirtualCardManager;
