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
  formatInCurrency: (amount: number, currencyCode: string) => string;
  supportedCurrencies: CurrencyConfig[];
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const STORAGE_KEY = 'preferred_currency';
const DEFAULT_CURRENCY: SupportedCurrency = 'ZMW';

// Region → currency fallback, seeded from the supported list's own
// locales and extended to the euro area and Crown dependencies (used
// only when Intl.Locale cannot report a currency list itself).
const REGION_TO_CURRENCY: Record<string, SupportedCurrency> = {
  ...Object.fromEntries(
    SUPPORTED_CURRENCIES.map((c) => {
      const region = c.locale.split('-').pop()?.toUpperCase() ?? '';
      return [region, c.code];
    }),
  ),
  ...Object.fromEntries(
    [
      'AT', 'BE', 'CY', 'EE', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT',
      'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK', 'AD', 'MC', 'SM', 'VA',
      'ME',
    ].map((region) => [region, 'EUR' as SupportedCurrency]),
  ),
  GG: 'GBP',
  JE: 'GBP',
  IM: 'GBP',
};

/**
 * First-visit display currency for a visitor with NO saved preference,
 * derived from their browser locale: a Zambian locale → ZMW; a locale
 * whose currency is one of the other supported currencies → that
 * currency; anything else (including no/unparsable locale) → USD.
 * BMaGlass Pay is global — ZMW is home, not a worldwide default.
 */
export function detectDefaultCurrency(
  locale?: string | null,
): SupportedCurrency {
  if (!locale) return 'USD';
  try {
    const parsed = new Intl.Locale(locale);
    if (parsed.region === 'ZM') return 'ZMW';
    const withCurrencies = parsed as Intl.Locale & {
      getCurrencies?: () => string[];
    };
    const fromIntl =
      typeof withCurrencies.getCurrencies === 'function'
        ? withCurrencies.getCurrencies()[0]
        : undefined;
    const candidate =
      fromIntl ?? (parsed.region ? REGION_TO_CURRENCY[parsed.region] : undefined);
    if (
      candidate &&
      candidate !== 'ZMW' &&
      SUPPORTED_CURRENCIES.some((c) => c.code === candidate)
    ) {
      return candidate as SupportedCurrency;
    }
    return 'USD';
  } catch {
    return 'USD';
  }
}

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currency, setCurrencyState] = useState<SupportedCurrency>(() => {
    if (typeof window !== 'undefined') {
      // A saved preference ALWAYS wins over the locale default.
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED_CURRENCIES.some(c => c.code === stored)) {
        return stored as SupportedCurrency;
      }
      return detectDefaultCurrency(navigator.language);
    }
    return detectDefaultCurrency(undefined);
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

  // CURRENCY INTEGRITY CONTRACT (CEO order 2026-11-11: "currencies
  // don't mix" + "currency switcher should work flawless"):
  //  - formatAmount denominates a figure in the DISPLAY preference.
  //    It NEVER converts — it only labels. It must therefore never be
  //    used for a real balance, ledger row, quote or bill: labelling a
  //    ZMW amount with a $ sign (or vice versa) is exactly the mixing
  //    the CEO reported.
  //  - Real money is denominated in its OWN currency, always, via
  //    formatInCurrency(amount, row.currency / wallet.currency /
  //    card.currency). The rendered figure is then identical whatever
  //    the display preference is — switching A→B→A cannot create,
  //    destroy or relabel a single ngwee or cent.
  //  - The switcher itself is display-only: setCurrency writes ONLY
  //    the localStorage preference below. It never touches a stored
  //    balance, a ledger row, or the currency of an in-flight quote
  //    or checkout (those are denominated server-side in the wallet /
  //    link currency).
  const formatInCurrency = useCallback((amount: number, currencyCode: string): string => {
    return formatMoneyInCurrency(amount, currencyCode);
  }, []);

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
        formatInCurrency,
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

/**
 * Narrow an arbitrary currency code (e.g. a transaction row's
 * `currency` column) to a supported one, or undefined when it is not
 * one we format — callers pass the result as formatAmount's override
 * so a row always renders in ITS OWN currency, and an unrecognised
 * code falls back to the viewer's display currency instead of
 * throwing inside Intl.NumberFormat.
 */
export function toSupportedCurrency(
  code: string | null | undefined,
): SupportedCurrency | undefined {
  return SUPPORTED_CURRENCIES.some((c) => c.code === code)
    ? (code as SupportedCurrency)
    : undefined;
}

/**
 * Format an amount in its OWN currency — the only correct way to
 * render a real balance or ledger figure. Pure and preference-free:
 * the same (amount, currency) pair renders identically no matter what
 * the display-currency switcher is set to, so a switch round-trip
 * (ZMW→USD→ZMW) returns the original figure untouched.
 */
export const formatMoneyInCurrency = (
  amount: number,
  currencyCode: string,
): string => {
  const code = (currencyCode || DEFAULT_CURRENCY).toUpperCase();
  const config = SUPPORTED_CURRENCIES.find(c => c.code === code);
  try {
    return new Intl.NumberFormat(config?.locale || 'en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
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
