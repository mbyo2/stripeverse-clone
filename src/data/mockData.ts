
// Mock data for development purposes

export const paymentMethods = [
  {
    id: '1',
    type: 'card' as const,
    name: 'Personal Visa',
    details: '**** **** **** 1234',
    status: 'active' as const,
    isDefault: true,
    provider: 'visa',
    last4: '1234',
    expiryDate: '12/25'
  },
  {
    id: '2',
    type: 'mobile_money' as const,
    name: 'MTN Mobile Money',
    details: '+260 97 123 4567',
    status: 'active' as const,
    isDefault: false,
    provider: 'mtn'
  },
  {
    id: '3',
    type: 'bank_account' as const,
    name: 'Zanaco Savings',
    details: '****1234',
    status: 'active' as const,
    isDefault: false,
    provider: 'zanaco'
  }
];

export const virtualCards = [
  {
    id: 1,
    name: "Shopping Card",
    number: "4532 1234 5678 9012",
    balance: 150.00,
    status: "active",
    provider: "Visa"
  },
  {
    id: 2,
    name: "Subscription Card",
    number: "5555 4444 3333 2222",
    balance: 85.50,
    status: "active",
    provider: "Mastercard"
  }
];
