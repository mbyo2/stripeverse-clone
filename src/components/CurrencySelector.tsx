import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCurrency, SupportedCurrency } from '@/contexts/CurrencyContext';
import { Globe } from 'lucide-react';

interface CurrencySelectorProps {
  showLabel?: boolean;
  className?: string;
  compact?: boolean;
}

export const CurrencySelector: React.FC<CurrencySelectorProps> = ({
  showLabel = false,
  className = '',
  compact = false,
}) => {
  const { currency, setCurrency, supportedCurrencies } = useCurrency();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {showLabel && (
        <label className="text-sm text-muted-foreground whitespace-nowrap">
          Currency:
        </label>
      )}
      <Select value={currency} onValueChange={(value) => setCurrency(value as SupportedCurrency)}>
        <SelectTrigger className={compact ? 'w-[90px]' : 'w-[180px]'}>
          <Globe className="h-4 w-4 mr-2 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {supportedCurrencies.map((curr) => (
            <SelectItem key={curr.code} value={curr.code}>
              {compact ? curr.code : `${curr.code} - ${curr.name}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default CurrencySelector;
