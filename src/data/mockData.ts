
// Mock virtual cards data
export const mockVirtualCards = {
  1: {
    id: 1,
    name: "Shopping Card",
    number: "**** **** **** 4444",
    balance: 350.00,
    provider: "Visa",
    status: "active",
    transactions: [
      { id: 1, date: "2023-05-15", amount: -45.00, description: "Amazon.com", category: "Shopping" },
      { id: 2, date: "2023-05-12", amount: -120.50, description: "Shoprite", category: "Groceries" },
      { id: 3, date: "2023-05-10", amount: 200.00, description: "Funding", category: "Transfer" }
    ]
  },
  2: {
    id: 2,
    name: "Subscription Card",
    number: "**** **** **** 7890",
    balance: 125.50,
    provider: "Mastercard",
    status: "active",
    transactions: [
      { id: 1, date: "2023-05-14", amount: -12.99, description: "Netflix", category: "Entertainment" },
      { id: 2, date: "2023-05-13", amount: -9.99, description: "Spotify", category: "Entertainment" },
      { id: 3, date: "2023-05-08", amount: 150.00, description: "Funding", category: "Transfer" }
    ]
  }
};

// Mock payment methods
export const paymentMethods = [
  { id: 1, type: "card", name: "Visa Card", number: "**** **** **** 3456", expiry: "12/25" },
  { id: 2, type: "bank", name: "Zambia National Bank", number: "**** **** 7890", branch: "Cairo Road" },
  { id: 3, type: "card", name: "Mastercard", number: "**** **** **** 5555", expiry: "09/24" },
  { id: 4, type: "bank", name: "Stanbic Bank", number: "**** **** 1234", branch: "Lusaka Main" }
];

// Mock wallet data
export const getWalletBalance = () => 2450.00;

// Mock transaction history
export const mockTransactions = [
  { id: 1, date: "2023-05-20", amount: -100.00, description: "Payment to John Doe", category: "Transfer" },
  { id: 2, date: "2023-05-18", amount: 500.00, description: "Deposit from Bank Account", category: "Deposit" },
  { id: 3, date: "2023-05-15", amount: -45.00, description: "Mobile Money Transfer", category: "Transfer" },
  { id: 4, date: "2023-05-12", amount: -120.50, description: "Payment for Services", category: "Payment" },
  { id: 5, date: "2023-05-10", amount: 200.00, description: "Refund from Merchant", category: "Refund" },
  { id: 6, date: "2023-05-07", amount: -33.75, description: "Utility Bill Payment", category: "Bill" },
  { id: 7, date: "2023-05-05", amount: 1000.00, description: "Salary Deposit", category: "Income" },
  { id: 8, date: "2023-05-03", amount: -250.00, description: "Rent Payment", category: "Housing" }
];

// Mock user profiles
export const mockUsers = {
  current: {
    id: "user-1",
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    phone: "097XXXXXXX",
    walletBalance: 2450.00
  },
  contacts: [
    { id: "user-2", name: "Jane Smith", phone: "096XXXXXXX" },
    { id: "user-3", name: "Michael Johnson", phone: "095XXXXXXX" },
    { id: "user-4", name: "Sarah Williams", phone: "077XXXXXXX" },
    { id: "user-5", name: "Robert Brown", phone: "076XXXXXXX" }
  ]
};

// Mock card providers
export const cardProviders = [
  { id: "visa", name: "Visa", logo: "visa-logo.png" },
  { id: "mastercard", name: "Mastercard", logo: "mastercard-logo.png" },
  { id: "amex", name: "American Express", logo: "amex-logo.png" }
];

// Mock bank accounts
export const bankAccounts = [
  { id: 1, name: "Primary Savings", number: "**** **** 1234", bank: "Zanaco", balance: 3500.00 },
  { id: 2, name: "Business Account", number: "**** **** 5678", bank: "Stanbic", balance: 12000.00 }
];
