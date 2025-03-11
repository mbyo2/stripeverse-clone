
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  CreditCard, 
  PlusCircle, 
  Eye, 
  EyeOff, 
  Copy, 
  Lock, 
  ShieldCheck, 
  RefreshCw,
  ArrowRight,
  Trash2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { VirtualCard } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/utils";

// Mock function to create a virtual card - in a real app, this would call an API
const createVirtualCard = async (cardData: any): Promise<VirtualCard> => {
  // In a real app, this would call your API or a Supabase edge function
  // For now, we're just mocking the response
  const newCard: VirtualCard = {
    id: `card_${Date.now()}`,
    user_id: "user_123",
    name: cardData.name,
    number: "4111 2222 3333 4444",
    masked_number: "**** **** **** 4444",
    cvv: "123",
    expiry: "12/25",
    balance: 0,
    status: "active",
    provider: cardData.provider,
    card_type: cardData.cardType,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    currency: "ZMW",
    limits: {
      daily: cardData.dailyLimit || 5000,
      monthly: cardData.monthlyLimit || 50000,
      transaction: cardData.transactionLimit || 2000
    },
    settings: {
      online_transactions: cardData.allowOnline || true,
      international_transactions: cardData.allowInternational || false
    }
  };
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return newCard;
};

// Schema for card creation form
const createCardSchema = z.object({
  name: z.string().min(3, "Card name must be at least 3 characters"),
  provider: z.string().min(1, "Please select a card provider"),
  cardType: z.string().min(1, "Please select a card type"),
  dailyLimit: z.coerce.number().min(100).max(10000).optional(),
  monthlyLimit: z.coerce.number().min(1000).max(100000).optional(),
  transactionLimit: z.coerce.number().min(100).max(5000).optional(),
  allowOnline: z.boolean().default(true),
  allowInternational: z.boolean().default(false),
});

interface VirtualCardManagerProps {
  maxCards?: number;
}

const VirtualCardManager = ({ maxCards = 5 }: VirtualCardManagerProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCardDetails, setShowCardDetails] = useState<Record<string, boolean>>({});
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  
  // Form setup
  const form = useForm<z.infer<typeof createCardSchema>>({
    resolver: zodResolver(createCardSchema),
    defaultValues: {
      name: "",
      provider: "visa",
      cardType: "virtual",
      dailyLimit: 5000,
      monthlyLimit: 50000,
      transactionLimit: 2000,
      allowOnline: true,
      allowInternational: false,
    },
  });
  
  // Fetch virtual cards
  const { data: virtualCards = [], isLoading } = useQuery({
    queryKey: ['virtualCards'],
    queryFn: async () => {
      // In a real app, this would fetch from an API or database
      // For now, return mock data
      return [
        {
          id: "card_1",
          user_id: "user_123",
          name: "Shopping Card",
          number: "4111 2222 3333 4444",
          masked_number: "**** **** **** 4444",
          cvv: "123",
          expiry: "12/25",
          balance: 350.00,
          status: "active",
          provider: "visa",
          card_type: "virtual",
          created_at: "2023-10-01T12:00:00Z",
          updated_at: "2023-10-01T12:00:00Z",
          currency: "ZMW",
          limits: {
            daily: 5000,
            monthly: 50000,
            transaction: 2000
          },
          settings: {
            online_transactions: true,
            international_transactions: false
          }
        },
        {
          id: "card_2",
          user_id: "user_123",
          name: "Subscription Card",
          number: "5111 2222 3333 4444",
          masked_number: "**** **** **** 4444",
          cvv: "456",
          expiry: "06/26",
          balance: 125.50,
          status: "active",
          provider: "mastercard",
          card_type: "virtual",
          created_at: "2023-09-15T10:30:00Z",
          updated_at: "2023-09-15T10:30:00Z",
          currency: "ZMW",
          limits: {
            daily: 2000,
            monthly: 20000,
            transaction: 1000
          },
          settings: {
            online_transactions: true,
            international_transactions: false
          }
        }
      ] as VirtualCard[];
    }
  });
  
  // Create card mutation
  const createCardMutation = useMutation({
    mutationFn: createVirtualCard,
    onSuccess: (newCard) => {
      queryClient.setQueryData(['virtualCards'], (old: VirtualCard[] | undefined) => 
        old ? [...old, newCard] : [newCard]
      );
      toast({
        title: "Card Created",
        description: `Your new ${newCard.provider} card has been created successfully.`,
      });
      setIsCreateDialogOpen(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Failed to Create Card",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  });
  
  const handleCreateCard = (values: z.infer<typeof createCardSchema>) => {
    if (virtualCards.length >= maxCards) {
      toast({
        title: "Maximum Cards Reached",
        description: `You can have a maximum of ${maxCards} virtual cards.`,
        variant: "destructive",
      });
      return;
    }
    
    createCardMutation.mutate(values);
  };
  
  const handleViewCardDetails = (cardId: string) => {
    navigate(`/virtual-card/${cardId}`);
  };
  
  const handleToggleCardDetails = (cardId: string) => {
    setShowCardDetails(prev => ({
      ...prev,
      [cardId]: !prev[cardId]
    }));
  };
  
  const handleCopyCardNumber = (cardNumber: string) => {
    navigator.clipboard.writeText(cardNumber);
    toast({
      title: "Copied",
      description: "Card number copied to clipboard.",
    });
  };
  
  const handleFreezeCard = (cardId: string) => {
    // In a real app, this would call an API
    toast({
      title: "Card Status Updated",
      description: "Your card status has been updated successfully.",
    });
    
    // Update local state
    queryClient.setQueryData(['virtualCards'], (old: VirtualCard[] | undefined) => 
      old ? old.map(card => 
        card.id === cardId 
          ? { ...card, status: card.status === 'active' ? 'frozen' : 'active' } 
          : card
      ) : []
    );
  };
  
  const handleFundCard = (cardId: string) => {
    navigate(`/virtual-card/fund`, { state: { cardId } });
  };
  
  return (
    <div className="space-y-6">
      {/* Header with create button */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Your Virtual Cards</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button
              disabled={virtualCards.length >= maxCards || createCardMutation.isPending}
            >
              <PlusCircle className="mr-2 h-4 w-4" /> Create Card
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create New Virtual Card</DialogTitle>
              <DialogDescription>
                Fill in the details below to create a new virtual card for online payments.
              </DialogDescription>
            </DialogHeader>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleCreateCard)} className="space-y-4 py-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Card Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Shopping Card" {...field} />
                      </FormControl>
                      <FormDescription>
                        Give your card a memorable name
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="provider"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Card Provider</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select card provider" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="visa">Visa</SelectItem>
                          <SelectItem value="mastercard">Mastercard</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="cardType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Card Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select card type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="virtual">Virtual Card</SelectItem>
                          <SelectItem value="physical">Physical Card</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="dailyLimit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Daily Limit (K)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="transactionLimit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Transaction Limit (K)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <FormField
                  control={form.control}
                  name="allowOnline"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Online Transactions</FormLabel>
                        <FormDescription>
                          Allow this card to be used for online purchases
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="allowInternational"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">International Transactions</FormLabel>
                        <FormDescription>
                          Allow this card to be used for international purchases
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                <DialogFooter>
                  <Button type="submit" disabled={createCardMutation.isPending}>
                    {createCardMutation.isPending ? (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Creating...
                      </>
                    ) : (
                      "Create Card"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
      
      {/* Card list */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map(i => (
            <Card key={i} className="border-l-4 border-l-gray-200">
              <CardContent className="p-6 animate-pulse">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="h-5 w-32 bg-secondary rounded mb-2"></div>
                    <div className="h-4 w-24 bg-secondary rounded"></div>
                  </div>
                  <div className="flex items-center justify-center w-10 h-10 bg-secondary rounded-full"></div>
                </div>
                <div className="mb-4">
                  <div className="h-4 w-20 bg-secondary rounded mb-2"></div>
                  <div className="h-6 w-24 bg-secondary rounded"></div>
                </div>
                <div className="flex justify-between mb-4">
                  <div className="h-4 w-20 bg-secondary rounded"></div>
                  <div className="h-4 w-20 bg-secondary rounded"></div>
                </div>
                <div className="flex space-x-2">
                  <div className="h-8 w-20 bg-secondary rounded"></div>
                  <div className="h-8 w-20 bg-secondary rounded"></div>
                  <div className="h-8 w-20 bg-secondary rounded"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : virtualCards.length === 0 ? (
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center text-center py-12">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <CreditCard className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">No Virtual Cards</h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              Create a virtual card to make online payments or subscriptions safely. You can create up to {maxCards} virtual cards.
            </p>
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Create Your First Card
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {virtualCards.map((card) => (
            <Card key={card.id} className={`border-l-4 ${
              card.status === 'active' 
                ? 'border-l-green-500' 
                : card.status === 'frozen' 
                  ? 'border-l-amber-500' 
                  : 'border-l-red-500'
            }`}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-medium text-lg">{card.name}</h3>
                    <div className="font-mono text-sm text-muted-foreground">
                      {showCardDetails[card.id] ? card.number : card.masked_number}
                      <button 
                        onClick={() => handleToggleCardDetails(card.id)}
                        className="ml-2 text-muted-foreground hover:text-foreground transition-colors inline-flex"
                      >
                        {showCardDetails[card.id] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                      <button 
                        onClick={() => handleCopyCardNumber(card.number)}
                        className="ml-1 text-muted-foreground hover:text-foreground transition-colors inline-flex"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-center w-10 h-10 bg-primary/10 rounded-full">
                    <CreditCard className="h-5 w-5 text-primary" />
                  </div>
                </div>
                
                <div className="mb-4">
                  <div className="text-sm font-medium text-muted-foreground">Balance</div>
                  <div className="text-xl font-bold">{formatCurrency(card.balance)}</div>
                </div>
                
                <div className="flex justify-between text-sm mb-4">
                  <div className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${
                      card.status === 'active' ? 'bg-green-500' : 
                      card.status === 'frozen' ? 'bg-amber-500' : 'bg-red-500'
                    }`}></div>
                    <span className={`font-medium ${
                      card.status === 'active' ? 'text-green-600' : 
                      card.status === 'frozen' ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {card.status.charAt(0).toUpperCase() + card.status.slice(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium capitalize">{card.provider}</span>
                  </div>
                </div>
                
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => handleFundCard(card.id)}>
                    Fund
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleFreezeCard(card.id)}>
                    {card.status === 'active' ? 'Freeze' : 'Unfreeze'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleViewCardDetails(card.id)}>
                    Details
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {/* Create card promo */}
      {virtualCards.length > 0 && virtualCards.length < maxCards && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-2">
                <h3 className="text-lg font-medium">Need another card?</h3>
                <p className="text-muted-foreground">
                  Create different cards for different purposes to better manage your spending.
                </p>
              </div>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" /> Create New Card
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default VirtualCardManager;
