import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseKey);

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

// USSD Response
interface UssdResponse extends PaymentResponse {
  referenceCode: string;
  ussdCode: string;
}

// KYC verification types
enum KycVerificationLevel {
  NONE = 'none',
  BASIC = 'basic',
  FULL = 'full'
}

// Transaction record
interface TransactionRecord {
  id?: number;
  user_id?: string;
  amount: number;
  currency: string;
  payment_method: string;
  direction: 'incoming' | 'outgoing';
  recipient_name?: string;
  recipient_account?: string;
  recipient_bank?: string;
  status: 'pending' | 'completed' | 'failed';
  reference?: string;
  provider?: string;
  metadata?: any;
}

// Function to record transaction in the database
async function recordTransaction(transaction: TransactionRecord): Promise<void> {
  try {
    // Add timestamp
    const transactionWithTimestamp = {
      ...transaction,
      created_at: new Date().toISOString(),
    };

    // Insert into transactions table
    const { error } = await supabase
      .from('transactions')
      .insert(transactionWithTimestamp);

    if (error) {
      console.error("Error recording transaction:", error);
      throw error;
    }

    console.log("Transaction recorded successfully:", transactionWithTimestamp.reference);
  } catch (err) {
    console.error("Failed to record transaction:", err);
    // Don't throw here, so payment can still proceed even if recording fails
  }
}

// MTN Mobile Money integration
async function processMtnMobileMoney(phoneNumber: string, amount: number): Promise<MobileMoneyResponse> {
  console.log(`Processing MTN payment of ${amount} to ${phoneNumber}`);
  
  // In a real implementation, this would make API calls to MTN's API
  // Documentation: https://momodeveloper.mtn.com/
  
  try {
    // This would normally include MTN API auth tokens, transaction payload, etc.
    // Mock API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Generate transaction reference
    const transactionId = `MTN-${Math.floor(100000 + Math.random() * 900000)}`;
    
    // In production, this would process the response from MTN API
    const isSuccess = Math.random() < 0.9;
    
    // Record the transaction in our database
    await recordTransaction({
      amount: amount,
      currency: 'ZMW',
      payment_method: 'mobile_money',
      direction: 'incoming',
      recipient_name: 'MTN Mobile Money',
      recipient_account: phoneNumber,
      status: isSuccess ? 'completed' : 'failed',
      reference: transactionId,
      provider: 'mtn',
      metadata: {
        phoneNumber,
        provider: 'mtn'
      }
    });
    
    return {
      transactionId,
      status: isSuccess ? 'success' : 'failed',
      message: isSuccess 
        ? `Payment of K${amount.toFixed(2)} successful` 
        : 'Transaction failed. Please try again.',
      provider: 'mtn',
      phoneNumber
    };
  } catch (error) {
    console.error("MTN Mobile Money error:", error);
    throw new Error("Failed to process MTN Mobile Money payment");
  }
}

// Airtel Money integration
async function processAirtelMoney(phoneNumber: string, amount: number): Promise<MobileMoneyResponse> {
  console.log(`Processing Airtel Money payment of ${amount} to ${phoneNumber}`);
  
  // In a real implementation, this would make API calls to Airtel's API
  // Documentation: https://developers.airtel.africa/
  
  try {
    // This would normally include Airtel API auth tokens, transaction payload, etc.
    // Mock API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Generate transaction reference
    const transactionId = `AIRT-${Math.floor(100000 + Math.random() * 900000)}`;
    
    // In production, this would process the response from Airtel API
    const isSuccess = Math.random() < 0.9;
    
    // Record the transaction
    await recordTransaction({
      amount: amount,
      currency: 'ZMW',
      payment_method: 'mobile_money',
      direction: 'incoming',
      recipient_name: 'Airtel Money',
      recipient_account: phoneNumber,
      status: isSuccess ? 'completed' : 'failed',
      reference: transactionId,
      provider: 'airtel',
      metadata: {
        phoneNumber,
        provider: 'airtel'
      }
    });
    
    return {
      transactionId,
      status: isSuccess ? 'success' : 'failed',
      message: isSuccess 
        ? `Payment of K${amount.toFixed(2)} successful` 
        : 'Transaction failed. Please try again.',
      provider: 'airtel',
      phoneNumber
    };
  } catch (error) {
    console.error("Airtel Money error:", error);
    throw new Error("Failed to process Airtel Money payment");
  }
}

// Zamtel Money integration
async function processZamtelMoney(phoneNumber: string, amount: number): Promise<MobileMoneyResponse> {
  console.log(`Processing Zamtel Money payment of ${amount} to ${phoneNumber}`);
  
  try {
    // Mock API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const transactionId = `ZTL-${Math.floor(100000 + Math.random() * 900000)}`;
    const isSuccess = Math.random() < 0.85;
    
    // Record the transaction
    await recordTransaction({
      amount: amount,
      currency: 'ZMW',
      payment_method: 'mobile_money',
      direction: 'incoming',
      recipient_name: 'Zamtel Money',
      recipient_account: phoneNumber,
      status: isSuccess ? 'completed' : 'failed',
      reference: transactionId,
      provider: 'zamtel',
      metadata: {
        phoneNumber,
        provider: 'zamtel'
      }
    });
    
    return {
      transactionId,
      status: isSuccess ? 'success' : 'failed',
      message: isSuccess 
        ? `Payment of K${amount.toFixed(2)} successful` 
        : 'Transaction failed. Please try again.',
      provider: 'zamtel',
      phoneNumber
    };
  } catch (error) {
    console.error("Zamtel Money error:", error);
    throw new Error("Failed to process Zamtel Money payment");
  }
}

// Processes mobile money payment based on provider
async function processMobileMoneyPayment(
  phoneNumber: string,
  amount: number,
  provider: string
): Promise<MobileMoneyResponse> {
  // Route to the correct provider implementation
  switch(provider.toLowerCase()) {
    case 'mtn':
      return processMtnMobileMoney(phoneNumber, amount);
    case 'airtel':
      return processAirtelMoney(phoneNumber, amount);
    case 'zamtel':
      return processZamtelMoney(phoneNumber, amount);
    default:
      throw new Error(`Unsupported mobile money provider: ${provider}`);
  }
}

// Simulate Zanaco bank integration
async function processZanacoTransfer(
  accountNumber: string,
  accountName: string,
  amount: number
): Promise<BankTransferResponse> {
  console.log(`Processing Zanaco transfer of ${amount} to ${accountNumber}`);
  
  try {
    // Mock API call delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const reference = `ZNC-${Math.floor(100000 + Math.random() * 900000)}`;
    const transactionId = `BNK-${Math.floor(100000 + Math.random() * 900000)}`;
    
    // Record the transaction
    await recordTransaction({
      amount: amount,
      currency: 'ZMW',
      payment_method: 'bank_transfer',
      direction: 'outgoing',
      recipient_name: accountName,
      recipient_account: accountNumber,
      recipient_bank: 'Zanaco',
      status: 'pending',
      reference: reference,
      provider: 'zanaco',
      metadata: {
        accountNumber,
        bankName: 'Zanaco',
        reference
      }
    });
    
    return {
      transactionId,
      status: 'pending',
      message: `Bank transfer of K${amount.toFixed(2)} initiated. Reference: ${reference}`,
      provider: 'Zanaco',
      accountNumber,
      bankName: 'Zanaco',
      reference
    };
  } catch (error) {
    console.error("Zanaco transfer error:", error);
    throw new Error("Failed to process Zanaco transfer");
  }
}

// Simulated bank transfer processing with different banks
async function processBankTransfer(
  accountNumber: string,
  bankName: string,
  accountName: string,
  amount: number
): Promise<BankTransferResponse> {
  // Route to specific bank implementations
  switch(bankName.toLowerCase()) {
    case 'zanaco':
      return processZanacoTransfer(accountNumber, accountName, amount);
    case 'stanbic':
    case 'absa':
    case 'fnb':
    case 'indo-zambia':
      // Generic implementation for other banks
      console.log(`Processing ${bankName} transfer of ${amount} to ${accountNumber}`);
      
      try {
        // Mock API call delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const reference = `BNK-${Math.floor(100000 + Math.random() * 900000)}`;
        const transactionId = `BNK-${Math.floor(100000 + Math.random() * 900000)}`;
        
        // Record the transaction
        await recordTransaction({
          amount: amount,
          currency: 'ZMW',
          payment_method: 'bank_transfer',
          direction: 'outgoing',
          recipient_name: accountName,
          recipient_account: accountNumber,
          recipient_bank: bankName,
          status: 'pending',
          reference: reference,
          provider: bankName.toLowerCase(),
          metadata: {
            accountNumber,
            bankName,
            reference
          }
        });
        
        return {
          transactionId,
          status: 'pending',
          message: `Bank transfer of K${amount.toFixed(2)} initiated. Reference: ${reference}`,
          provider: bankName,
          accountNumber,
          bankName,
          reference
        };
      } catch (error) {
        console.error(`${bankName} transfer error:`, error);
        throw new Error(`Failed to process ${bankName} transfer`);
      }
    default:
      throw new Error(`Unsupported bank: ${bankName}`);
  }
}

// Process USSD payment with richer integration
async function processUssdPayment(
  ussdCode: string,
  referenceCode: string,
  amount: number,
  provider: string
): Promise<UssdResponse> {
  console.log(`Processing USSD payment: ${ussdCode}, ref: ${referenceCode}, amount: ${amount}, provider: ${provider}`);
  
  try {
    // In a real implementation, this would register the payment in the system
    // and create a USSD session that the user would interact with
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const transactionId = `USD-${Math.floor(100000 + Math.random() * 900000)}`;
    
    // Record the transaction as pending
    await recordTransaction({
      amount: amount,
      currency: 'ZMW',
      payment_method: 'ussd',
      direction: 'incoming',
      status: 'pending',
      reference: referenceCode,
      provider: provider.toLowerCase(),
      metadata: {
        ussdCode,
        referenceCode,
        provider
      }
    });
    
    // Generate provider-specific USSD code with embedded reference
    let fullUssdCode = "";
    switch(provider.toLowerCase()) {
      case 'mtn':
        fullUssdCode = `*305*${referenceCode}#`;
        break;
      case 'airtel':
        fullUssdCode = `*778*${referenceCode}#`;
        break;
      case 'zamtel':
        fullUssdCode = `*422*${referenceCode}#`;
        break;
      default:
        fullUssdCode = ussdCode;
    }
    
    return {
      transactionId,
      status: 'pending',
      message: `USSD payment of K${amount.toFixed(2)} initiated. Dial ${fullUssdCode} on your phone to complete payment.`,
      provider,
      referenceCode,
      ussdCode: fullUssdCode
    };
  } catch (error) {
    console.error("USSD payment error:", error);
    throw new Error("Failed to process USSD payment");
  }
}

// Basic KYC verification
async function verifyKyc(userId: string, data: any): Promise<{level: KycVerificationLevel, message: string}> {
  console.log(`Processing KYC verification for user ${userId}`);
  
  try {
    // Check if the user already has KYC verification
    const { data: existingKyc, error: kycError } = await supabase
      .from('kyc_verifications')
      .select('*')
      .eq('user_id', userId)
      .single();
      
    if (kycError && kycError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      throw kycError;
    }
    
    // If user already has full verification, return that
    if (existingKyc && existingKyc.level === KycVerificationLevel.FULL) {
      return {
        level: KycVerificationLevel.FULL,
        message: "Your account is already fully verified."
      };
    }
    
    // Process the KYC data
    const { firstName, lastName, idType, idNumber, dateOfBirth, address, selfieImage } = data;
    
    // In a real implementation, this would validate ID numbers, check against government databases, etc.
    // For now, we'll do basic validation
    if (!firstName || !lastName || !idType || !idNumber || !dateOfBirth) {
      return {
        level: KycVerificationLevel.NONE,
        message: "Missing required verification information."
      };
    }
    
    // Determine verification level based on provided data
    let verificationLevel = KycVerificationLevel.BASIC;
    
    // If all advanced data is provided, upgrade to full verification
    if (address && selfieImage) {
      verificationLevel = KycVerificationLevel.FULL;
    }
    
    // Save or update KYC information
    if (existingKyc) {
      // Update existing record
      const { error: updateError } = await supabase
        .from('kyc_verifications')
        .update({
          level: verificationLevel,
          first_name: firstName,
          last_name: lastName,
          id_type: idType,
          id_number: idNumber,
          date_of_birth: dateOfBirth,
          address: address || existingKyc.address,
          selfie_url: selfieImage || existingKyc.selfie_url,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
        
      if (updateError) throw updateError;
    } else {
      // Create new record
      const { error: insertError } = await supabase
        .from('kyc_verifications')
        .insert({
          user_id: userId,
          level: verificationLevel,
          first_name: firstName,
          last_name: lastName,
          id_type: idType,
          id_number: idNumber,
          date_of_birth: dateOfBirth,
          address: address || null,
          selfie_url: selfieImage || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        
      if (insertError) throw insertError;
    }
    
    return {
      level: verificationLevel,
      message: verificationLevel === KycVerificationLevel.FULL 
        ? "Your account has been fully verified."
        : "Basic verification completed. Upload additional documents for full verification."
    };
  } catch (error) {
    console.error("KYC verification error:", error);
    throw new Error("Failed to process KYC verification");
  }
}

// Check KYC verification level
async function checkKycLevel(userId: string): Promise<KycVerificationLevel> {
  try {
    if (!userId) return KycVerificationLevel.NONE;
    
    const { data, error } = await supabase
      .from('kyc_verifications')
      .select('level')
      .eq('user_id', userId)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return KycVerificationLevel.NONE;
      }
      throw error;
    }
    
    return data?.level as KycVerificationLevel || KycVerificationLevel.NONE;
  } catch (error) {
    console.error("Error checking KYC level:", error);
    return KycVerificationLevel.NONE;
  }
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
    case 'orange':
      return ['70', '71', '72'].includes(prefix);
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
    case 'atlas-mara':
      return sanitized.length === 10;
    case 'indo-zambia':
      return sanitized.length === 9;
    case 'invest-trust':
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

function identifyCardType(cardNumber: string): string {
  // Remove any non-numeric characters
  const cleaned = cardNumber.replace(/\D/g, '');
  
  // Check for card type based on IIN ranges
  if (/^4/.test(cleaned)) {
    return 'Visa';
  } else if (/^(5[1-5]|2[2-7])/.test(cleaned)) {
    return 'MasterCard';
  } else if (/^3[47]/.test(cleaned)) {
    return 'American Express';
  } else if (/^6(?:011|5)/.test(cleaned)) {
    return 'Discover';
  } else if (/^(?:2131|1800|35)/.test(cleaned)) {
    return 'JCB';
  } else if (/^3(?:0[0-5]|[68])/.test(cleaned)) {
    return 'Diners Club';
  } else {
    return 'Unknown';
  }
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
      if (!['mtn', 'airtel', 'zamtel', 'orange', 'mpesa'].includes(provider.toLowerCase())) {
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
      
      // Process the mobile money payment with enhanced implementation
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
      
      // Process bank transfer with our enhanced implementation
      const result = await processBankTransfer(accountNumber, bankName, 
        requestData.accountName || 'Not Provided', amount);
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    else if (paymentMethod === 'ussd') {
      const { ussdCode, referenceCode, amount, provider } = requestData;
      
      // Validate required fields
      if (!ussdCode || !referenceCode || !provider || !amount) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields for USSD payment' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Validate provider
      if (!['mtn', 'airtel', 'zamtel'].includes(provider.toLowerCase())) {
        return new Response(
          JSON.stringify({ error: 'Invalid USSD provider' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Process USSD payment with enhanced implementation
      const result = await processUssdPayment(ussdCode, referenceCode, amount, provider);
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    else if (paymentMethod === 'kyc-verification') {
      const { userId, data } = requestData;
      
      if (!userId) {
        return new Response(
          JSON.stringify({ error: 'User ID is required for KYC verification' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Process KYC verification
      const result = await verifyKyc(userId, data);
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    else if (paymentMethod === 'check-kyc') {
      const { userId } = requestData;
      
      if (!userId) {
        return new Response(
          JSON.stringify({ error: 'User ID is required for KYC check' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Check KYC level
      const kycLevel = await checkKycLevel(userId);
      
      return new Response(
        JSON.stringify({ level: kycLevel }),
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
    else if (paymentMethod === 'wallet-transfer') {
      const { senderPhone, receiverPhone, amount } = requestData;
      
      // Validate required fields
      if (!senderPhone || !receiverPhone || !amount) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields for wallet transfer' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Validate sender and receiver are different
      if (senderPhone === receiverPhone) {
        return new Response(
          JSON.stringify({ error: 'Sender and receiver cannot be the same' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Process wallet transfer
      const result = await processWalletTransfer(senderPhone, receiverPhone, amount);
      
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
