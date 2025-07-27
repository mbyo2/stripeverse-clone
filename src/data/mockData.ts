
import { environment } from '@/config/environment';

// Dynamic mock data configuration

interface MockConfig {
  environment: 'development' | 'staging' | 'production';
  userCount: number;
  transactionCount: number;
  currencies: string[];
  providers: string[];
}

const config: MockConfig = {
  environment: environment.NODE_ENV as 'development' | 'staging' | 'production',
  userCount: 1000,
  transactionCount: 5000,
  currencies: ['ZMW', 'USD', 'EUR', 'GBP'],
  providers: [...environment.DEFAULTS.PROVIDERS]
};

// Dynamic payment methods based on configuration
export const getPaymentMethods = (userId?: string) => [
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

// Dynamic virtual cards generation
export const generateVirtualCards = (count: number = 2) => {
  const cardTypes = ['Shopping Card', 'Subscription Card', 'Travel Card', 'Business Card'];
  const providers = ['Visa', 'Mastercard'];
  
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: cardTypes[i % cardTypes.length],
    number: generateCardNumber(providers[i % providers.length]),
    balance: parseFloat((Math.random() * 500 + 50).toFixed(2)),
    status: "active",
    provider: providers[i % providers.length]
  }));
};

// Generate realistic card numbers based on provider
const generateCardNumber = (provider: string): string => {
  const prefixes = {
    'Visa': '4532',
    'Mastercard': '5555'
  };
  
  const prefix = prefixes[provider as keyof typeof prefixes] || '4532';
  const remaining = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  const fullNumber = prefix + remaining;
  
  return fullNumber.replace(/(.{4})/g, '$1 ').trim();
};

export const virtualCards = generateVirtualCards();

// Dynamic mock virtual cards data for VirtualCardFund page
export const getMockVirtualCards = (count: number = 2) => {
  const cards = generateVirtualCards(count);
  return cards.reduce((acc, card) => {
    acc[card.id.toString()] = {
      id: card.id.toString(),
      name: card.name,
      number: card.number,
      balance: card.balance,
      provider: card.provider
    };
    return acc;
  }, {} as Record<string, any>);
};

export const mockVirtualCards = getMockVirtualCards();

// Dynamic user data based on environment
export const getMockUsers = () => ({
  current: {
    phone: config.environment === 'production' ? '+260970000000' : '+260971234567',
    walletBalance: config.environment === 'production' ? 0 : 1250.00
  }
});

export const mockUsers = getMockUsers();

// Dynamic transaction generation
export const generateMockTransactions = (count: number = 10) => {
  const types = ['deposit', 'withdrawal', 'transfer', 'payment'];
  const statuses = ['completed', 'pending', 'failed'];
  const descriptions = [
    'Mobile money deposit',
    'Card payment',
    'Wallet transfer',
    'Bill payment',
    'Merchant payment'
  ];

  return Array.from({ length: count }, (_, i) => ({
    id: `txn_${Date.now()}_${i}`,
    amount: parseFloat((Math.random() * 1000 + 10).toFixed(2)),
    currency: config.currencies[Math.floor(Math.random() * config.currencies.length)],
    type: types[Math.floor(Math.random() * types.length)],
    status: statuses[Math.floor(Math.random() * statuses.length)],
    description: descriptions[Math.floor(Math.random() * descriptions.length)],
    timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
    provider: config.providers[Math.floor(Math.random() * config.providers.length)]
  }));
};

// Environment-specific configurations
export const getEnvironmentConfig = () => ({
  apiBaseUrl: environment.API_BASE_URL,
  webhookBaseUrl: environment.WEBHOOK_BASE_URL,
  maxTransactionAmount: environment.LIMITS.MAX_TRANSACTION_AMOUNT,
  minTransactionAmount: environment.LIMITS.MIN_TRANSACTION_AMOUNT,
  features: environment.FEATURES
});

// Configuration functions for dynamic behavior
export const updateMockConfig = (newConfig: Partial<MockConfig>) => {
  Object.assign(config, newConfig);
};

export const getCurrentConfig = () => ({ ...config });

export const getAvailableCurrencies = () => [...config.currencies];
export const getAvailableProviders = () => [...config.providers];

// Utility functions for dynamic data
export const generateMockData = {
  users: (count: number) => Array.from({ length: count }, (_, i) => ({
    id: `user_${i}`,
    name: `User ${i + 1}`,
    phone: `+26097${String(i).padStart(7, '0')}`,
    walletBalance: parseFloat((Math.random() * 5000).toFixed(2))
  })),
  
  transactions: generateMockTransactions,
  
  virtualCards: generateVirtualCards,
  
  paymentMethods: getPaymentMethods
};

export { config as mockConfig };
