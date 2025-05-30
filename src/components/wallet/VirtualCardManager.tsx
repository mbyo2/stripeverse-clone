
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Plus, Eye, EyeOff, Settings, Snowflake, Power } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { formatCurrency } from "@/utils/walletUtils";

interface VirtualCardManagerProps {
  maxCards?: number;
}

const VirtualCardManager = ({ maxCards = 5 }: VirtualCardManagerProps) => {
  const { virtualCards, createVirtualCard, isCreatingCard } = useWallet();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newCardData, setNewCardData] = useState({
    name: '',
    initialBalance: 100,
    provider: 'visa',
    cardType: 'debit'
  });
  const [visibleCards, setVisibleCards] = useState<Set<string>>(new Set());

  const handleCreateCard = () => {
    createVirtualCard(newCardData);
    setShowCreateDialog(false);
    setNewCardData({
      name: '',
      initialBalance: 100,
      provider: 'visa',
      cardType: 'debit'
    });
  };

  const toggleCardVisibility = (cardId: string) => {
    const newVisible = new Set(visibleCards);
    if (newVisible.has(cardId)) {
      newVisible.delete(cardId);
    } else {
      newVisible.add(cardId);
    }
    setVisibleCards(newVisible);
  };

  const maskCardNumber = (number: string) => {
    return `**** **** **** ${number.slice(-4)}`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center">
            <CreditCard className="mr-2 h-5 w-5" />
            Virtual Cards ({virtualCards.length}/{maxCards})
          </CardTitle>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button 
                size="sm" 
                disabled={virtualCards.length >= maxCards}
                className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
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
                    <Select 
                      value={newCardData.provider} 
                      onValueChange={(value) => setNewCardData({ ...newCardData, provider: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="visa">Visa</SelectItem>
                        <SelectItem value="mastercard">Mastercard</SelectItem>
                        <SelectItem value="amex">American Express</SelectItem>
                      </SelectContent>
                    </Select>
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
              Create your first virtual card to start making secure online payments.
            </p>
            <Button 
              onClick={() => setShowCreateDialog(true)}
              className="bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Card
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {virtualCards.map((card) => (
              <div key={card.id} className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg p-4 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 bg-white/10 rounded-full -mr-10 -mt-10"></div>
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-semibold text-lg">{card.name}</h3>
                      <p className="text-sm opacity-80 capitalize">{card.provider} {card.card_type}</p>
                    </div>
                    <Badge variant={card.status === 'active' ? 'default' : 'secondary'}>
                      {card.status}
                    </Badge>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-lg">
                        {visibleCards.has(card.id) ? card.card_number : maskCardNumber(card.card_number)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleCardVisibility(card.id)}
                        className="text-white hover:bg-white/20"
                      >
                        {visibleCards.has(card.id) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <div className="flex justify-between mt-2 text-sm">
                      <span>CVV: {visibleCards.has(card.id) ? card.cvv : '***'}</span>
                      <span>Exp: {card.expiry_date}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm opacity-80">Balance</p>
                      <p className="text-xl font-bold">{formatCurrency(card.balance)}</p>
                    </div>
                    <div className="flex space-x-2">
                      <Button size="sm" variant="ghost" className="text-white hover:bg-white/20">
                        <Settings className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-white hover:bg-white/20">
                        <Snowflake className="h-4 w-4" />
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
