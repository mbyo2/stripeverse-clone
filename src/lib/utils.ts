
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
