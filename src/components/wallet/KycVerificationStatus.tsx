import { Shield, CheckCircle2, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export enum KycLevel {
  NONE = 'none',
  BASIC = 'basic',
  FULL = 'full'
}

export enum KycStatus {
  NOT_STARTED = 'not_started',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

interface KycVerificationStatusProps {
  level: KycLevel;
  status?: KycStatus;
  rejectionReason?: string;
}

// Status surfaces use the semantic tokens at tint strength
// (bg-primary/10, bg-success/10, bg-warning/10, bg-destructive/10) —
// the tokens carry their own dark values, so the panels follow the
// theme. The hard-coded light palettes this used before (bg-blue-50,
// bg-amber-50, bg-green-50 with *-700/800 text) stayed bright white /
// pastel in dark mode (rendered defect, 2026-11-11, /kyc).
const KycVerificationStatus = ({ 
  level, 
  status = KycStatus.NOT_STARTED,
  rejectionReason
}: KycVerificationStatusProps) => {
  
  // Determine the appropriate status display
  const renderStatusBadge = () => {
    switch (status) {
      case KycStatus.PENDING:
        return (
          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
            <Clock className="w-3 h-3 mr-1" />
            Pending Review
          </div>
        );
      case KycStatus.APPROVED:
        return (
          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Approved
          </div>
        );
      case KycStatus.REJECTED:
        return (
          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
            <XCircle className="w-3 h-3 mr-1" />
            Rejected
          </div>
        );
      default:
        return null;
    }
  };
  
  // Render the appropriate verification status card
  switch(level) {
    case KycLevel.FULL:
      return (
        <div className="bg-success/10 border border-success/25 rounded-lg p-4 flex items-start">
          <CheckCircle2 className="h-5 w-5 text-success mt-0.5 mr-3 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-foreground">Fully Verified</h3>
              {renderStatusBadge()}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Your account has been fully verified, so you're covered for the features that ask for verification — including higher P2P tiers and higher transaction limits.
            </p>
            <div className="mt-3 flex space-x-2">
              <div className="flex flex-col items-center">
                <div className="w-full h-1.5 bg-success rounded"></div>
                <span className="text-xs text-muted-foreground mt-1">Level 1</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <div className="w-full h-1.5 bg-success rounded"></div>
                <span className="text-xs text-muted-foreground mt-1">Level 2</span>
              </div>
            </div>
          </div>
        </div>
      );
    case KycLevel.BASIC:
      return (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 flex items-start">
          <Shield className="h-5 w-5 text-warning mt-0.5 mr-3 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-foreground">Basic Verification</h3>
              {renderStatusBadge()}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Your account has basic verification. Complete the full verification process below to increase your transaction limits.
            </p>
            {status === KycStatus.REJECTED && rejectionReason && (
              <div className="mt-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
                <strong>Reason:</strong> {rejectionReason}
              </div>
            )}
            <div className="mt-3 flex space-x-2">
              <div className="flex flex-col items-center">
                <div className="w-full h-1.5 bg-warning rounded"></div>
                <span className="text-xs text-muted-foreground mt-1">Level 1</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <div className={cn(
                  "w-full h-1.5 rounded",
                  status === KycStatus.PENDING ? "bg-warning/50" : "bg-warning/25"
                )}></div>
                <span className="text-xs text-muted-foreground mt-1">Level 2</span>
              </div>
            </div>
          </div>
        </div>
      );
    case KycLevel.NONE:
    default:
      return (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-start">
          <Shield className="h-5 w-5 text-primary mt-0.5 mr-3 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-medium text-foreground">Not Verified Yet</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Verify your identity only if you use a feature that needs it — like higher P2P tiers and bigger transaction limits. Everything else works without it.
            </p>
            {status === KycStatus.REJECTED && rejectionReason && (
              <div className="mt-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
                <strong>Reason:</strong> {rejectionReason}
              </div>
            )}
            <div className="mt-3 flex space-x-2">
              <div className="flex flex-col items-center">
                <div className="w-full h-1.5 bg-primary/30 rounded"></div>
                <span className="text-xs text-muted-foreground mt-1">Level 1</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <div className="w-full h-1.5 bg-primary/15 rounded"></div>
                <span className="text-xs text-muted-foreground mt-1">Level 2</span>
              </div>
            </div>
          </div>
        </div>
      );
  }
};

export default KycVerificationStatus;
