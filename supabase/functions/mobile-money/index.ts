
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Base response interface for all payment methods
interface PaymentResponse {
  transactionId: string;
  status: 'pending' | 'success' | 'failed';
  message: string;
  provider: string;
}

// Mobile Money response
interface MobileMoneyResponse extends PaymentResponse {
  phoneNumber: string;
}

// Bank Transfer response
interface BankTransferResponse extends PaymentResponse {
  accountNumber: string;
  bankName: string;
  reference: string;
}

// Card Payment response
interface CardPaymentResponse extends PaymentResponse {
  cardLast4: string;
  cardType: string;
}

// Simulated mobile money transaction processing
async function processMobileMoneyPayment(
  phoneNumber: string,
  amount: number,
  provider: string
): Promise<MobileMoneyResponse> {
  // In a real implementation, this would make API calls to the respective mobile money providers
  console.log(`Processing ${provider} payment of ${amount} to ${phoneNumber}`);
  
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // For demonstration purposes, generate a random transaction ID
  const transactionId = `${provider.substring(0, 3).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;
  
  // Simulate success (90% of the time) or failure
  const isSuccess = Math.random() < 0.9;
  
  return {
    transactionId,
    status: isSuccess ? 'success' : 'failed',
    message: isSuccess 
      ? `Payment of K${amount.toFixed(2)} successful` 
      : 'Transaction failed. Please try again.',
    provider,
    phoneNumber
  };
}

// Simulated bank transfer processing
async function processBankTransfer(
  accountNumber: string,
  bankName: string,
  amount: number
): Promise<BankTransferResponse> {
  console.log(`Processing bank transfer of ${amount} to ${accountNumber} at ${bankName}`);
  
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Generate a reference number for the transfer
  const reference = `BNK-${Math.floor(100000 + Math.random() * 900000)}`;
  const transactionId = `BNK-${Math.floor(100000 + Math.random() * 900000)}`;
  
  // Bank transfers are typically pending until confirmed
  return {
    transactionId,
    status: 'pending',
    message: `Bank transfer of K${amount.toFixed(2)} initiated. Reference: ${reference}`,
    provider: bankName,
    accountNumber,
    bankName,
    reference
  };
}

// Simulated card payment processing
async function processCardPayment(
  cardNumber: string,
  expiryDate: string,
  cvv: string,
  amount: number
): Promise<CardPaymentResponse> {
  console.log(`Processing card payment of ${amount}`);
  
  // Simulate API call delay and process
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Get last 4 digits for reference
  const cardLast4 = cardNumber.slice(-4);
  
  // Determine card type based on first digit
  const firstDigit = cardNumber.charAt(0);
  let cardType = "Unknown";
  
  if (firstDigit === "4") {
    cardType = "Visa";
  } else if (firstDigit === "5") {
    cardType = "MasterCard";
  } else if (firstDigit === "3") {
    cardType = "Amex";
  }
  
  const transactionId = `CRD-${Math.floor(100000 + Math.random() * 900000)}`;
  
  // Simulate success (95% of the time) or failure
  const isSuccess = Math.random() < 0.95;
  
  return {
    transactionId,
    status: isSuccess ? 'success' : 'failed',
    message: isSuccess 
      ? `Card payment of K${amount.toFixed(2)} successful` 
      : 'Card payment failed. Please check your details and try again.',
    provider: cardType,
    cardLast4,
    cardType
  };
}

// Validate mobile number based on Zambian mobile network patterns
function validateMobileNumber(number: string, provider: string): boolean {
  const sanitized = number.replace(/\D/g, '');
  
  // Check if it's a valid Zambian number format
  const isValidFormat = 
    (sanitized.length === 10 && sanitized.startsWith('0')) || 
    (sanitized.length === 12 && sanitized.startsWith('26'));
  
  if (!isValidFormat) return false;
  
  // Extract the network prefix
  const prefix = sanitized.startsWith('0') 
    ? sanitized.substring(1, 3) 
    : sanitized.substring(3, 5);
  
  // Check provider-specific prefixes
  switch(provider.toLowerCase()) {
    case 'mtn':
      return ['76', '77', '78'].includes(prefix);
    case 'airtel':
      return ['97', '96', '95'].includes(prefix);
    case 'zamtel':
      return ['50', '51', '52'].includes(prefix);
    default:
      return false;
  }
}

// Validate bank account number format
function validateBankAccount(accountNumber: string, bankName: string): boolean {
  // This would need to be customized for Zambian banks
  // Basic validation for demonstration purposes
  const sanitized = accountNumber.replace(/\D/g, '');
  
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

// Basic Luhn algorithm for card validation
function validateCardNumber(cardNumber: string): boolean {
  const sanitized = cardNumber.replace(/\D/g, '');
  
  if (sanitized.length < 13 || sanitized.length > 19) {
    return false;
  }
  
  let sum = 0;
  let double = false;
  
  for (let i = sanitized.length - 1; i >= 0; i--) {
    let digit = parseInt(sanitized.charAt(i));
    
    if (double) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    
    sum += digit;
    double = !double;
  }
  
  return sum % 10 === 0;
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const requestData = await req.json();
    const { paymentMethod } = requestData;
    
    // Process based on payment method type
    if (paymentMethod === 'mobile-money') {
      const { phoneNumber, amount, provider } = requestData;
      
      // Validate required fields
      if (!phoneNumber || !amount || !provider) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields for mobile money payment' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Validate provider
      if (!['mtn', 'airtel', 'zamtel'].includes(provider.toLowerCase())) {
        return new Response(
          JSON.stringify({ error: 'Invalid mobile money provider' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Validate phone number format
      if (!validateMobileNumber(phoneNumber, provider)) {
        return new Response(
          JSON.stringify({ error: 'Invalid phone number for selected provider' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Process the mobile money payment
      const result = await processMobileMoneyPayment(phoneNumber, amount, provider);
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } 
    else if (paymentMethod === 'bank-transfer') {
      const { accountNumber, bankName, amount } = requestData;
      
      // Validate required fields
      if (!accountNumber || !bankName || !amount) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields for bank transfer' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Validate bank account format
      if (!validateBankAccount(accountNumber, bankName)) {
        return new Response(
          JSON.stringify({ error: 'Invalid account number for selected bank' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Process bank transfer
      const result = await processBankTransfer(accountNumber, bankName, amount);
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    else if (paymentMethod === 'card') {
      const { cardNumber, expiryDate, cvv, amount } = requestData;
      
      // Validate required fields
      if (!cardNumber || !expiryDate || !cvv || !amount) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields for card payment' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Validate card using Luhn algorithm
      if (!validateCardNumber(cardNumber)) {
        return new Response(
          JSON.stringify({ error: 'Invalid card number' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Basic expiry date validation (MM/YY format)
      const expiryRegex = /^(0[1-9]|1[0-2])\/([0-9]{2})$/;
      if (!expiryRegex.test(expiryDate)) {
        return new Response(
          JSON.stringify({ error: 'Invalid expiry date format. Use MM/YY' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Basic CVV validation (3-4 digits)
      if (!/^[0-9]{3,4}$/.test(cvv)) {
        return new Response(
          JSON.stringify({ error: 'Invalid CVV' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Process card payment
      const result = await processCardPayment(cardNumber, expiryDate, cvv, amount);
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    else {
      return new Response(
        JSON.stringify({ error: 'Unsupported payment method' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
  } catch (error) {
    console.error('Error processing payment:', error);
    
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
