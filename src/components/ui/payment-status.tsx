import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentStatusProps {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  className?: string;
}

const statusConfig = {
  pending: {
    label: 'Pending',
    icon: Clock,
    className: 'bg-warning/10 text-amber-700 dark:text-amber-400 border-warning/30',
  },
  processing: {
    label: 'Processing',
    icon: Clock,
    className: 'bg-primary/10 text-primary border-primary/20',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle,
    className: 'bg-success/10 text-success border-success/20',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    className: 'bg-destructive/10 text-destructive border-destructive/20',
  },
  cancelled: {
    label: 'Cancelled',
    icon: AlertCircle,
    className: 'bg-muted text-muted-foreground border-border',
  },
};

// Payment rows can carry statuses written before this map existed;
// an unmapped lookup crashed every list rendering this badge —
// fall back to a neutral "Unknown" (2026-10-29 crash-proofing).
const FALLBACK_STATUS = {
  label: 'Unknown',
  icon: AlertCircle,
  className: 'bg-muted text-muted-foreground border-border',
};

export const PaymentStatus: React.FC<PaymentStatusProps> = ({ status, className }) => {
  const config = statusConfig[status as keyof typeof statusConfig] ?? FALLBACK_STATUS;
  const Icon = config.icon;

  return (
    <Badge 
      variant="outline" 
      className={cn(config.className, 'inline-flex items-center gap-1', className)}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
};