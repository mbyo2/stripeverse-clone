// Environment configuration
export const environment = {
  // Application environment
  NODE_ENV: import.meta.env.MODE || 'development',
  
  // API endpoints
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'https://api.sandbox.bmaglass.com',
  
  // PayPal environment configuration
  PAYPAL_ENV: import.meta.env.VITE_PAYPAL_ENV || 'sandbox', // 'sandbox' or 'production'
  
  // External service URLs
  BTCPAY_URL: import.meta.env.VITE_BTCPAY_URL || 'https://btcpay.sandbox.com',
  WEBHOOK_BASE_URL: import.meta.env.VITE_WEBHOOK_BASE_URL || 'https://webhooks.sandbox.bmaglass.com',
  
  // Feature flags
  FEATURES: {
    VIRTUAL_CARDS: true,
    INTERNATIONAL_PAYMENTS: import.meta.env.MODE === 'production',
    CRYPTO_PAYMENTS: import.meta.env.MODE !== 'production',
    ADVANCED_ANALYTICS: import.meta.env.MODE === 'production',
    DEBUG_MODE: import.meta.env.MODE === 'development'
  },
  
  // Limits based on environment
  LIMITS: {
    MAX_TRANSACTION_AMOUNT: import.meta.env.MODE === 'production' ? 100000 : 10000,
    MIN_TRANSACTION_AMOUNT: import.meta.env.MODE === 'production' ? 1 : 0.01,
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  },
  
  // Default values
  DEFAULTS: {
    CURRENCY: 'ZMW',
    PROVIDERS: ['mtn', 'airtel', 'zamtel', 'visa', 'mastercard', 'zanaco'],
    PHONE_PREFIX: '+260'
  }
} as const;

export const isDevelopment = () => environment.NODE_ENV === 'development';
export const isProduction = () => environment.NODE_ENV === 'production';
export const isStaging = () => environment.NODE_ENV === 'staging';