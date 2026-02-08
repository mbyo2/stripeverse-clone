/**
 * Format date as human-readable text
 */
import { type ClassValue, clsx } from "clsx";
import { formatDistanceToNow } from 'date-fns';
import { twMerge } from "tailwind-merge";

/**
 * Utility function for merging class names with Tailwind CSS
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(input: string | number | Date): string {
  const date = new Date(input);
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format date as relative time
 * e.g. "2 days ago"
 */
export function formatTimeToNow(date: Date): string {
  return formatDistanceToNow(date, {
    addSuffix: true
  });
}

/**
 * Format a credit card number with spaces every 4 digits
 */
export const formatCardNumber = (value: string): string => {
  const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
  const matches = v.match(/\d{4,16}/g);
  const match = matches && matches[0] || '';
  const parts = [];

  for (let i = 0, len = match.length; i < len; i += 4) {
    parts.push(match.substring(i, i + 4));
  }

  if (parts.length) {
    return parts.join(' ');
  } else {
    return value;
  }
};

/**
 * Format currency
 */
export const formatCurrency = (amount: number): string => {
  return `K ${amount.toFixed(2)}`;
};

/**
 * Validate card number using Luhn algorithm
 */
export const validateCardNumber = (number: string): boolean => {
  // Remove all spaces and non-digits
  const value = number.replace(/\D/g, '');
  
  if (value.length < 13 || value.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  // Loop through values starting from the rightmost digit
  for (let i = value.length - 1; i >= 0; i--) {
    let digit = parseInt(value.charAt(i));

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return (sum % 10) === 0;
};

/**
 * Validate mobile money number
 */
export const isMobileMoneyNumber = (number: string, provider: string): boolean => {
  // Remove all non-digits
  const cleanNumber = number.replace(/\D/g, '');
  
  // Check if the number is valid length (at least 10 digits)
  if (cleanNumber.length < 10) {
    return false;
  }
  
  // Check provider-specific prefixes
  const prefixes: Record<string, string[]> = {
    'mtn': ['076', '077', '078'],
    'airtel': ['095', '096', '097'],
    'zamtel': ['050', '051', '052']
  };
  
  const providerPrefixes = prefixes[provider.toLowerCase()];
  if (!providerPrefixes) {
    return false;
  }
  
  // Check if number starts with the correct prefix
  for (const prefix of providerPrefixes) {
    if (cleanNumber.startsWith(prefix) || cleanNumber.startsWith('0' + prefix.substring(1))) {
      return true;
    }
    
    // Handle international format (+260)
    if (cleanNumber.startsWith('260' + prefix.substring(1))) {
      return true;
    }
  }
  
  return false;
};

/**
 * Format phone number for display
 */
export const formatPhoneForDisplay = (phoneNumber: string): string => {
  // Remove non-digits
  const cleaned = phoneNumber.replace(/\D/g, '');
  
  // Check if it's a Zambian number
  if (cleaned.startsWith('260') && cleaned.length >= 12) {
    // Format as: +260 97 1234567
    return `+${cleaned.substring(0, 3)} ${cleaned.substring(3, 5)} ${cleaned.substring(5)}`;
  } else if (cleaned.startsWith('0') && cleaned.length >= 10) {
    // Format as: 097 1234567
    return `${cleaned.substring(0, 3)} ${cleaned.substring(3)}`;
  }
  
  // Return original if pattern doesn't match
  return phoneNumber;
};

/**
 * Validate wallet transfer
 */
export const validateWalletTransfer = (
  senderPhone: string, 
  receiverPhone: string, 
  amount: number
): { valid: boolean; message?: string } => {
  // Check if sender and receiver are the same
  if (senderPhone === receiverPhone) {
    return { 
      valid: false, 
      message: "You cannot transfer money to yourself" 
    };
  }
  
  // Validate amount is positive
  if (amount <= 0) {
    return {
      valid: false,
      message: "Amount must be greater than zero"
    };
  }
  
  // In a real app, we would validate that receiver exists in our system
  // For now, we'll just check if it looks like a valid phone number
  const cleanReceiverPhone = receiverPhone.replace(/\D/g, '');
  if (cleanReceiverPhone.length < 10 || cleanReceiverPhone.length > 12) {
    return {
      valid: false,
      message: "Please enter a valid receiver phone number"
    };
  }
  
  return { valid: true };
};

/**
 * Validate a Bitcoin address
 * Basic validation for Bitcoin addresses
 */
export const validateBitcoinAddress = (address: string): boolean => {
  // Basic validation for different Bitcoin address formats
  
  // Legacy addresses (P2PKH) start with 1
  const legacyRegex = /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  
  // Segwit addresses (P2SH) start with 3
  const segwitRegex = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  
  // Bech32 addresses (native Segwit) start with bc1
  const bech32Regex = /^bc1[a-z0-9]{39,59}$/;
  
  return legacyRegex.test(address) || segwitRegex.test(address) || bech32Regex.test(address);
};

/**
 * Validate a Lightning Network invoice
 * Basic validation for Lightning Network invoices (BOLT-11 format)
 */
export const validateLightningInvoice = (invoice: string): boolean => {
  // Lightning invoices start with 'lnbc' (Bitcoin mainnet)
  // or 'lntb' (Bitcoin testnet) and are base58 encoded
  const lightningRegex = /^ln(bc|tb)[a-zA-Z0-9]{1,}$/;
  return lightningRegex.test(invoice);
};

/**
 * Format a Bitcoin amount with proper units
 */
export const formatBitcoinAmount = (amount: number): string => {
  if (amount >= 1) {
    return `${amount.toFixed(8)} BTC`;
  } else if (amount >= 0.001) {
    return `${(amount * 1000).toFixed(5)} mBTC`;
  } else if (amount >= 0.000001) {
    return `${(amount * 1000000).toFixed(2)} μBTC`;
  } else {
    return `${(amount * 100000000).toFixed(0)} sats`;
  }
};

/**
 * Generate a mock BTCPay server checkout URL
 * In a real implementation, this would call the BTCPay Server API
 */
export const generateBTCPayCheckoutUrl = (
  amount: number, 
  orderId: string, 
  currency: string = 'ZMW'
): string => {
  // In a real implementation, this would generate a BTCPay Server checkout URL
  // This would be configured per environment
  const btcPayUrl = import.meta.env.VITE_BTCPAY_URL || 'https://btcpay.sandbox.com';
  return `${btcPayUrl}/checkout?amount=${amount}&orderId=${orderId}&currency=${currency}`;
};
