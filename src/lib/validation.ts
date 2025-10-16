import { z } from 'zod';

// Contact form validation
export const contactFormSchema = z.object({
  email: z.string()
    .trim()
    .email({ message: "Invalid email address" })
    .max(255, { message: "Email must be less than 255 characters" }),
});

// Transfer form validation
export const transferFormSchema = z.object({
  receiverPhone: z.string()
    .trim()
    .min(10, { message: "Phone number must be at least 10 digits" })
    .max(15, { message: "Phone number must be less than 15 digits" })
    .regex(/^[0-9+]+$/, { message: "Phone number can only contain digits and +" }),
  amount: z.number()
    .positive({ message: "Amount must be greater than 0" })
    .max(1000000, { message: "Amount exceeds maximum limit" }),
  note: z.string()
    .trim()
    .max(500, { message: "Note must be less than 500 characters" })
    .optional(),
});

// Virtual card creation validation
export const virtualCardSchema = z.object({
  name: z.string()
    .trim()
    .min(1, { message: "Card name is required" })
    .max(50, { message: "Card name must be less than 50 characters" })
    .regex(/^[a-zA-Z0-9\s-]+$/, { message: "Card name can only contain letters, numbers, spaces, and hyphens" }),
  initialBalance: z.number()
    .nonnegative({ message: "Initial balance must be 0 or greater" })
    .max(100000, { message: "Initial balance exceeds maximum limit" }),
  provider: z.enum(['mastercard'], { message: "Invalid provider" }),
  cardType: z.enum(['debit', 'prepaid'], { message: "Invalid card type" }),
  dailyLimit: z.number()
    .positive({ message: "Daily limit must be greater than 0" })
    .max(50000, { message: "Daily limit exceeds maximum" })
    .optional(),
  monthlyLimit: z.number()
    .positive({ message: "Monthly limit must be greater than 0" })
    .max(500000, { message: "Monthly limit exceeds maximum" })
    .optional(),
});

// Payment processing validation
export const paymentSchema = z.object({
  amount: z.number()
    .positive({ message: "Amount must be greater than 0" })
    .max(1000000, { message: "Amount exceeds maximum limit" }),
  currency: z.string()
    .length(3, { message: "Currency must be 3 characters (ISO code)" })
    .regex(/^[A-Z]+$/, { message: "Currency must be uppercase letters" }),
  phoneNumber: z.string()
    .trim()
    .min(10, { message: "Phone number must be at least 10 digits" })
    .max(15, { message: "Phone number must be less than 15 digits" })
    .regex(/^[0-9+]+$/, { message: "Phone number can only contain digits and +" })
    .optional(),
});

// Newsletter subscription validation
export const newsletterSchema = z.object({
  email: z.string()
    .trim()
    .email({ message: "Invalid email address" })
    .max(255, { message: "Email must be less than 255 characters" }),
});

// Generic sanitization helpers
export const sanitizeString = (input: string, maxLength: number = 1000): string => {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, ''); // Remove potential HTML tags
};

export const sanitizeNumeric = (input: string): string => {
  return input.replace(/[^0-9.+-]/g, '');
};

export const sanitizePhone = (input: string): string => {
  return input.replace(/[^0-9+]/g, '');
};
