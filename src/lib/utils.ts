
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string, currency = "ZMW") {
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) return `K 0.00`;
  
  return `K ${numAmount.toFixed(2)}`;
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .map(part => part.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

export function maskPhoneNumber(phoneNumber: string) {
  if (!phoneNumber) return '';
  const last4 = phoneNumber.slice(-4);
  return `**** **** ${last4}`;
}

export function generateTransactionId() {
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `ZP${random}`;
}

export function formatDate(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

export function formatTime(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit', 
    hour12: true 
  });
}

export function validateCardNumber(cardNumber: string): boolean {
  // Remove spaces and non-numeric characters
  const sanitized = cardNumber.replace(/\D/g, '');
  
  // Check if length is between 13-19 digits (common card number lengths)
  if (sanitized.length < 13 || sanitized.length > 19) {
    return false;
  }
  
  // Basic Luhn algorithm check (standard card validation)
  let sum = 0;
  let double = false;
  
  // Loop from right to left
  for (let i = sanitized.length - 1; i >= 0; i--) {
    let digit = parseInt(sanitized.charAt(i));
    
    // Double every second digit
    if (double) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    
    sum += digit;
    double = !double;
  }
  
  // Valid card numbers will have a sum that's a multiple of 10
  return sum % 10 === 0;
}

export function formatCardNumber(cardNumber: string): string {
  // Remove spaces and non-numeric characters
  const sanitized = cardNumber.replace(/\D/g, '');
  
  // Format in groups of 4 (like 4242 4242 4242 4242)
  const groups = [];
  for (let i = 0; i < sanitized.length; i += 4) {
    groups.push(sanitized.slice(i, i + 4));
  }
  
  return groups.join(' ');
}

export function isMobileMoneyNumber(phoneNumber: string, provider?: string): boolean {
  // Basic validation for Zambian mobile numbers
  const sanitized = phoneNumber.replace(/\D/g, '');
  
  // Check if it's a valid Zambian number (10 digits starting with 0 or 26X)
  const isZambianFormat = 
    (sanitized.length === 10 && sanitized.startsWith('0')) || 
    (sanitized.length === 12 && sanitized.startsWith('26'));
  
  if (!isZambianFormat) return false;
  
  if (!provider) return true;
  
  // Check provider-specific prefixes
  const prefix = sanitized.startsWith('0') ? sanitized.substring(1, 3) : sanitized.substring(3, 5);
  
  switch(provider.toLowerCase()) {
    case 'mtn':
      return ['76', '77', '78'].includes(prefix);
    case 'airtel':
      return ['97', '96', '95'].includes(prefix);
    case 'zamtel':
      return ['50', '51', '52'].includes(prefix);
    default:
      return true;
  }
}

export function validateBankAccount(accountNumber: string, bankName: string): boolean {
  // Remove spaces and non-numeric characters
  const sanitized = accountNumber.replace(/\D/g, '');
  
  // Different banks have different account number formats
  switch(bankName.toLowerCase()) {
    case 'zanaco':
      return sanitized.length === 10;
    case 'stanbic':
      return sanitized.length === 11;
    case 'fnb':
      return sanitized.length === 9;
    case 'absa':
      return sanitized.length === 12;
    default:
      // Generic check for other banks
      return sanitized.length >= 8 && sanitized.length <= 16;
  }
}

export function getPaymentMethodIcon(type: string) {
  // Card types
  if (type.toLowerCase().includes('visa')) return '💳';
  if (type.toLowerCase().includes('mastercard')) return '💳';
  if (type.toLowerCase().includes('amex')) return '💳';
  
  // Mobile money providers
  if (type.toLowerCase().includes('mtn')) return '📱';
  if (type.toLowerCase().includes('airtel')) return '📱';
  if (type.toLowerCase().includes('zamtel')) return '📱';
  
  // Banks
  if (type.toLowerCase().includes('zanaco')) return '🏦';
  if (type.toLowerCase().includes('stanbic')) return '🏦';
  if (type.toLowerCase().includes('fnb')) return '🏦';
  if (type.toLowerCase().includes('absa')) return '🏦';
  
  // Default
  return '💰';
}

export function getPaymentMethodName(method: string): string {
  // Split by underscore if present (e.g., "card_Visa" becomes ["card", "Visa"])
  const parts = method.split('_');
  
  if (parts.length > 1) {
    // Format the payment method with proper capitalization
    const type = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const provider = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
    
    return `${type} - ${provider}`;
  }
  
  // If no underscore, just capitalize the first letter
  return method.charAt(0).toUpperCase() + method.slice(1);
}

export function formatBankAccountNumber(accountNumber: string): string {
  // Remove spaces and non-numeric characters
  const sanitized = accountNumber.replace(/\D/g, '');
  
  // Format in groups of 4 for readability
  const groups = [];
  for (let i = 0; i < sanitized.length; i += 4) {
    groups.push(sanitized.slice(i, i + 4));
  }
  
  return groups.join(' ');
}
