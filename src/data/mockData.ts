
// Mock virtual cards data
export const mockVirtualCards = {
  1: {
    id: 1,
    name: "Shopping Card",
    number: "**** **** **** 4444",
    balance: 350.00,
    provider: "Visa",
    status: "active"
  },
  2: {
    id: 2,
    name: "Subscription Card",
    number: "**** **** **** 4444",
    balance: 125.50,
    provider: "Mastercard",
    status: "active"
  }
};

// Mock payment methods
export const paymentMethods = [
  { id: 1, type: "card", name: "Visa Card", number: "**** **** **** 3456", expiry: "12/25" },
  { id: 2, type: "bank", name: "Zambia National Bank", number: "**** **** 7890", branch: "Cairo Road" },
];

export const getWalletBalance = () => 2450.00;
