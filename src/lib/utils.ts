/**
 * Format date as human-readable text
 */
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
import { formatDistanceToNow } from 'date-fns'

export function formatTimeToNow(date: Date): string {
  return formatDistanceToNow(date, {
    addSuffix: true
  })
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
