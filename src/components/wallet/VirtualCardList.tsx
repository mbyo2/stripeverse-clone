
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CreditCard, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface VirtualCard {
  id: number;
  name: string;
  number: string;
  balance: number;
  status: string;
  provider: string;
}

interface VirtualCardListProps {
  virtualCards: VirtualCard[];
  onCreateCard: () => void;
}

const VirtualCardList = ({ virtualCards, onCreateCard }: VirtualCardListProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { formatAmount } = useCurrency();

  const handleFundCard = (cardId: number) => {
    navigate("/virtual-card/fund", { state: { cardId } });
  };

  const handleFreezeCard = (cardId: number) => {
    // In a real app, this would make an API call to freeze the card
    toast({
      title: "Card Frozen",
      description: "Your virtual card has been temporarily frozen.",
    });
  };

  if (virtualCards.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <CreditCard className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-xl font-medium mb-2">No Virtual Cards</h3>
          <p className="text-muted-foreground mb-4">
            Create a virtual card to make online payments or subscriptions safely.
          </p>
          <Button onClick={onCreateCard}>
            <PlusCircle className="mr-2 h-4 w-4" /> Create Your First Card
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {virtualCards.map((card) => (
        <Card key={card.id} className={`border-l-4 ${card.status === 'active' ? 'border-l-green-500' : 'border-l-amber-500'}`}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-medium text-lg">{card.name}</h3>
                <p className="text-sm text-muted-foreground">{card.number}</p>
              </div>
              <div className="flex items-center justify-center w-10 h-10 bg-primary/10 rounded-full">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="mb-4">
              <div className="text-sm font-medium text-muted-foreground">Balance</div>
              <div className="text-xl font-bold">{formatAmount(card.balance)}</div>
            </div>
            <div className="flex justify-between text-sm mb-4">
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span className={`font-medium ${card.status === 'active' ? 'text-green-600' : 'text-amber-600'}`}>
                  {card.status.charAt(0).toUpperCase() + card.status.slice(1)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Provider: </span>
                <span className="font-medium">{card.provider}</span>
              </div>
            </div>
            <div className="flex space-x-2">
              <Button variant="outline" size="sm" onClick={() => handleFundCard(card.id)}>Add Funds</Button>
              <Button variant="outline" size="sm" onClick={() => handleFreezeCard(card.id)}>
                {card.status === 'active' ? 'Freeze' : 'Unfreeze'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/virtual-card/${card.id}`)}>Details</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default VirtualCardList;
