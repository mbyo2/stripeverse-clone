import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Smartphone, Building, Plus, MoreHorizontal, Trash2, Edit } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface PaymentMethod {
  id: string;
  type: 'card' | 'mobile_money' | 'bank_account';
  name: string;
  details: string;
  status: 'active' | 'expired' | 'disabled';
  isDefault: boolean;
  provider?: string;
  last4?: string;
  expiryDate?: string;
}

interface PaymentMethodListProps {
  paymentMethods: PaymentMethod[];
}

const PaymentMethodList = ({ paymentMethods: initialMethods }: PaymentMethodListProps) => {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(initialMethods);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newMethodData, setNewMethodData] = useState({
    type: 'card' as 'card' | 'mobile_money' | 'bank_account',
    name: '',
    cardNumber: '',
    expiryDate: '',
    cvv: '',
    phoneNumber: '',
    provider: '',
    bankName: '',
    accountNumber: ''
  });

  const getMethodIcon = (type: string) => {
    switch (type) {
      case 'card':
        return <CreditCard className="h-5 w-5" />;
      case 'mobile_money':
        return <Smartphone className="h-5 w-5" />;
      case 'bank_account':
        return <Building className="h-5 w-5" />;
      default:
        return <CreditCard className="h-5 w-5" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'expired':
        return 'bg-red-100 text-red-800';
      case 'disabled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleAddMethod = () => {
    const newMethod: PaymentMethod = {
      id: Date.now().toString(),
      type: newMethodData.type,
      name: newMethodData.name,
      details: newMethodData.type === 'card' 
        ? `**** **** **** ${newMethodData.cardNumber.slice(-4)}`
        : newMethodData.type === 'mobile_money'
        ? newMethodData.phoneNumber
        : newMethodData.accountNumber,
      status: 'active',
      isDefault: paymentMethods.length === 0,
      provider: newMethodData.provider,
      last4: newMethodData.type === 'card' ? newMethodData.cardNumber.slice(-4) : undefined,
      expiryDate: newMethodData.type === 'card' ? newMethodData.expiryDate : undefined
    };

    setPaymentMethods([...paymentMethods, newMethod]);
    setShowAddDialog(false);
    setNewMethodData({
      type: 'card',
      name: '',
      cardNumber: '',
      expiryDate: '',
      cvv: '',
      phoneNumber: '',
      provider: '',
      bankName: '',
      accountNumber: ''
    });
  };

  const handleSetDefault = (id: string) => {
    setPaymentMethods(methods =>
      methods.map(method => ({
        ...method,
        isDefault: method.id === id
      }))
    );
  };

  const handleRemoveMethod = (id: string) => {
    setPaymentMethods(methods => methods.filter(method => method.id !== id));
  };

  const renderAddMethodForm = () => {
    switch (newMethodData.type) {
      case 'card':
        return (
          <>
            <div>
              <Label htmlFor="cardName">Card Name</Label>
              <Input
                id="cardName"
                placeholder="e.g., Personal Visa"
                value={newMethodData.name}
                onChange={(e) => setNewMethodData({ ...newMethodData, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cardNumber">Card Number</Label>
              <Input
                id="cardNumber"
                placeholder="1234 5678 9012 3456"
                value={newMethodData.cardNumber}
                onChange={(e) => setNewMethodData({ ...newMethodData, cardNumber: e.target.value.replace(/\s/g, '') })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="expiryDate">Expiry Date</Label>
                <Input
                  id="expiryDate"
                  placeholder="MM/YY"
                  value={newMethodData.expiryDate}
                  onChange={(e) => setNewMethodData({ ...newMethodData, expiryDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cvv">CVV</Label>
                <Input
                  id="cvv"
                  placeholder="123"
                  value={newMethodData.cvv}
                  onChange={(e) => setNewMethodData({ ...newMethodData, cvv: e.target.value })}
                />
              </div>
            </div>
          </>
        );
      case 'mobile_money':
        return (
          <>
            <div>
              <Label htmlFor="mmName">Account Name</Label>
              <Input
                id="mmName"
                placeholder="e.g., My MTN Money"
                value={newMethodData.name}
                onChange={(e) => setNewMethodData({ ...newMethodData, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="provider">Provider</Label>
              <Select value={newMethodData.provider} onValueChange={(value) => setNewMethodData({ ...newMethodData, provider: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mtn">MTN Mobile Money</SelectItem>
                  <SelectItem value="airtel">Airtel Money</SelectItem>
                  <SelectItem value="zamtel">Zamtel Kwacha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                placeholder="+260 XX XXX XXXX"
                value={newMethodData.phoneNumber}
                onChange={(e) => setNewMethodData({ ...newMethodData, phoneNumber: e.target.value })}
              />
            </div>
          </>
        );
      case 'bank_account':
        return (
          <>
            <div>
              <Label htmlFor="bankName">Bank Name</Label>
              <Input
                id="bankName"
                placeholder="e.g., Zanaco"
                value={newMethodData.bankName}
                onChange={(e) => setNewMethodData({ ...newMethodData, bankName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="accountName">Account Name</Label>
              <Input
                id="accountName"
                placeholder="e.g., My Savings Account"
                value={newMethodData.name}
                onChange={(e) => setNewMethodData({ ...newMethodData, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="accountNumber">Account Number</Label>
              <Input
                id="accountNumber"
                placeholder="Account number"
                value={newMethodData.accountNumber}
                onChange={(e) => setNewMethodData({ ...newMethodData, accountNumber: e.target.value })}
              />
            </div>
          </>
        );
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Payment Methods</CardTitle>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700">
                <Plus className="mr-2 h-4 w-4" />
                Add Method
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Payment Method</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Payment Method Type</Label>
                  <Select 
                    value={newMethodData.type} 
                    onValueChange={(value: 'card' | 'mobile_money' | 'bank_account') => 
                      setNewMethodData({ ...newMethodData, type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="card">Credit/Debit Card</SelectItem>
                      <SelectItem value="mobile_money">Mobile Money</SelectItem>
                      <SelectItem value="bank_account">Bank Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {renderAddMethodForm()}
                <Button 
                  onClick={handleAddMethod} 
                  disabled={!newMethodData.name}
                  className="w-full"
                >
                  Add Payment Method
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {paymentMethods.length === 0 ? (
          <div className="text-center py-8">
            <CreditCard className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Payment Methods</h3>
            <p className="text-muted-foreground mb-4">
              Add a payment method to start funding your wallet.
            </p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Method
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {paymentMethods.map((method) => (
              <div key={method.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="p-2 bg-muted rounded-full">
                    {getMethodIcon(method.type)}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="font-medium">{method.name}</h3>
                      {method.isDefault && (
                        <Badge variant="secondary" className="text-xs">Default</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{method.details}</p>
                    {method.provider && (
                      <p className="text-xs text-muted-foreground capitalize">{method.provider}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge className={getStatusColor(method.status)}>
                    {method.status}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!method.isDefault && (
                        <DropdownMenuItem onClick={() => handleSetDefault(method.id)}>
                          Set as Default
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleRemoveMethod(method.id)}
                        className="text-red-600"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PaymentMethodList;
