
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, WalletCards } from "lucide-react";

const VirtualCardNew = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    cardName: "",
    initialFunding: 100,
    cardProvider: "visa",
    cardType: "debit",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === "initialFunding") {
      // Only allow positive numbers
      const amount = parseFloat(value);
      if (!isNaN(amount) && amount >= 0) {
        setFormData({ ...formData, [name]: amount });
      }
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // In a real app, this would make an API call to create the virtual card
    setTimeout(() => {
      setLoading(false);
      toast({
        title: "Virtual Card Created",
        description: `Your ${formData.cardProvider.toUpperCase()} virtual card has been created successfully.`,
      });
      navigate("/wallet");
    }, 1500);
  };

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-3xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Create Virtual Card</h1>
          <p className="text-muted-foreground mt-2">
            Virtual cards can be used for online payments, subscriptions, and more.
          </p>
        </div>
        
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>New Virtual Card</CardTitle>
            <CardDescription>
              Fill in the details to create your virtual card. You can fund it from your main wallet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cardName">Card Name</Label>
                  <Input
                    id="cardName"
                    name="cardName"
                    placeholder="e.g., Shopping Card, Netflix Card"
                    value={formData.cardName}
                    onChange={handleChange}
                    required
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="initialFunding">Initial Funding Amount</Label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                      K
                    </div>
                    <Input
                      id="initialFunding"
                      name="initialFunding"
                      type="number"
                      min="0"
                      step="0.01"
                      className="pl-8"
                      value={formData.initialFunding}
                      onChange={handleChange}
                      required
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This amount will be deducted from your wallet balance.
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cardProvider">Card Provider</Label>
                    <Select 
                      value={formData.cardProvider}
                      onValueChange={(value) => handleSelectChange("cardProvider", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select card provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="visa">Visa</SelectItem>
                        <SelectItem value="mastercard">Mastercard</SelectItem>
                        <SelectItem value="amex">American Express</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="cardType">Card Type</Label>
                    <Select 
                      value={formData.cardType}
                      onValueChange={(value) => handleSelectChange("cardType", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select card type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="debit">Debit Card</SelectItem>
                        <SelectItem value="prepaid">Prepaid Card</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="mt-6 flex flex-col space-y-2">
                  <Button type="submit" disabled={loading || !formData.cardName || formData.initialFunding <= 0}>
                    {loading ? "Creating..." : "Create Virtual Card"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => navigate("/wallet")}>
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>About Virtual Cards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start">
                <div className="mt-1 mr-4 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">Secure Online Payments</h3>
                  <p className="text-muted-foreground text-sm">
                    Use virtual cards for online shopping without exposing your main card details.
                  </p>
                </div>
              </div>
              
              <div className="flex items-start">
                <div className="mt-1 mr-4 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <WalletCards className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-medium">Budget Management</h3>
                  <p className="text-muted-foreground text-sm">
                    Create separate cards for different purposes to better track your spending.
                  </p>
                </div>
              </div>
              
              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-2">Fee Structure</h4>
                <ul className="text-sm text-muted-foreground space-y-2">
                  <li className="flex justify-between">
                    <span>Card Creation</span>
                    <span className="font-medium">Free</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Monthly Maintenance</span>
                    <span className="font-medium">K 5.00</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Card Funding</span>
                    <span className="font-medium">1% (min K 2.00)</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default VirtualCardNew;
