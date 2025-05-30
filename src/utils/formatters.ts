
export const formatCurrency = (amount: number, currency: string = 'ZMW'): string => {
  return new Intl.NumberFormat('en-ZM', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const formatDate = (date: string | Date): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-ZM', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateObj);
};

export const formatDateOnly = (date: string | Date): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-ZM', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);
};

export const formatPhoneNumber = (phone: string): string => {
  // Format Zambian phone numbers
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('260')) {
    const number = cleaned.substring(3);
    return `+260 ${number.substring(0, 2)} ${number.substring(2, 5)} ${number.substring(5)}`;
  }
  return phone;
};

export const maskCardNumber = (cardNumber: string): string => {
  return cardNumber.replace(/\d(?=\d{4})/g, '*');
};

export const formatPercentage = (value: number): string => {
  return `${value.toFixed(1)}%`;
};

export const formatLargeNumber = (num: number): string => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};
