import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type SupportedCurrency = 'ZMW' | 'USD' | 'EUR' | 'GBP';

interface CurrencyConfig {
  code: SupportedCurrency;
  name: string;
  symbol: string;
  locale: string;
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'K', locale: 'en-ZM' },
  { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US' },
  { code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE' },
  { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB' },
];

interface CurrencyContextType {
  currency: SupportedCurrency;
  currencyConfig: CurrencyConfig;
  setCurrency: (currency: SupportedCurrency) => void;
  formatAmount: (amount: number, overrideCurrency?: SupportedCurrency) => string;
  supportedCurrencies: CurrencyConfig[];
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const STORAGE_KEY = 'preferred_currency';
const DEFAULT_CURRENCY: SupportedCurrency = 'ZMW';

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<SupportedCurrency>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED_CURRENCIES.some(c => c.code === stored)) {
        return stored as SupportedCurrency;
      }
    }
    return DEFAULT_CURRENCY;
  });

  const currencyConfig = SUPPORTED_CURRENCIES.find(c => c.code === currency) || SUPPORTED_CURRENCIES[0];

  const setCurrency = useCallback((newCurrency: SupportedCurrency) => {
    setCurrencyState(newCurrency);
    localStorage.setItem(STORAGE_KEY, newCurrency);
  }, []);

  const formatAmount = useCallback((amount: number, overrideCurrency?: SupportedCurrency): string => {
    const currToUse = overrideCurrency || currency;
    const config = SUPPORTED_CURRENCIES.find(c => c.code === currToUse) || currencyConfig;
    
    return new Intl.NumberFormat(config.locale, {
      style: 'currency',
      currency: currToUse,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }, [currency, currencyConfig]);

  // Sync with localStorage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const newCurrency = e.newValue as SupportedCurrency;
        if (SUPPORTED_CURRENCIES.some(c => c.code === newCurrency)) {
          setCurrencyState(newCurrency);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        currencyConfig,
        setCurrency,
        formatAmount,
        supportedCurrencies: SUPPORTED_CURRENCIES,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};

// Standalone format function for use outside of React components
export const formatCurrencyStandalone = (
  amount: number, 
  currency: SupportedCurrency = DEFAULT_CURRENCY
): string => {
  const config = SUPPORTED_CURRENCIES.find(c => c.code === currency) || SUPPORTED_CURRENCIES[0];
  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};
