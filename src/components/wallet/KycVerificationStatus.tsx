
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
          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            <Clock className="w-3 h-3 mr-1" />
            Pending Review
          </div>
        );
      case KycStatus.APPROVED:
        return (
          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Approved
          </div>
        );
      case KycStatus.REJECTED:
        return (
          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
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
        <div className="bg-green-50 border border-green-100 rounded-lg p-4 flex items-start">
          <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-green-800">Fully Verified</h3>
              {renderStatusBadge()}
            </div>
            <p className="text-sm text-green-700 mt-1">
              Your account has been fully verified. You have access to all features and higher transaction limits.
            </p>
            <div className="mt-3 flex space-x-2">
              <div className="flex flex-col items-center">
                <div className="w-full h-1.5 bg-green-500 rounded"></div>
                <span className="text-xs text-green-700 mt-1">Level 1</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <div className="w-full h-1.5 bg-green-500 rounded"></div>
                <span className="text-xs text-green-700 mt-1">Level 2</span>
              </div>
            </div>
          </div>
        </div>
      );
    case KycLevel.BASIC:
      return (
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 flex items-start">
          <Shield className="h-5 w-5 text-amber-500 mt-0.5 mr-3 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-amber-800">Basic Verification</h3>
              {renderStatusBadge()}
            </div>
            <p className="text-sm text-amber-700 mt-1">
              Your account has basic verification. Complete the full verification process below to increase your transaction limits.
            </p>
            {status === KycStatus.REJECTED && rejectionReason && (
              <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                <strong>Reason:</strong> {rejectionReason}
              </div>
            )}
            <div className="mt-3 flex space-x-2">
              <div className="flex flex-col items-center">
                <div className="w-full h-1.5 bg-amber-500 rounded"></div>
                <span className="text-xs text-amber-700 mt-1">Level 1</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <div className={cn(
                  "w-full h-1.5 rounded",
                  status === KycStatus.PENDING ? "bg-amber-300" : "bg-amber-200"
                )}></div>
                <span className="text-xs text-amber-700 mt-1">Level 2</span>
              </div>
            </div>
          </div>
        </div>
      );
    case KycLevel.NONE:
    default:
      return (
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start">
          <Shield className="h-5 w-5 text-blue-500 mt-0.5 mr-3 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-medium text-blue-800">Verification Required</h3>
            <p className="text-sm text-blue-700 mt-1">
              Verify your identity to unlock higher transaction limits and additional features.
            </p>
            {status === KycStatus.REJECTED && rejectionReason && (
              <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                <strong>Reason:</strong> {rejectionReason}
              </div>
            )}
            <div className="mt-3 flex space-x-2">
              <div className="flex flex-col items-center">
                <div className="w-full h-1.5 bg-blue-200 rounded"></div>
                <span className="text-xs text-blue-700 mt-1">Level 1</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <div className="w-full h-1.5 bg-blue-100 rounded"></div>
                <span className="text-xs text-blue-700 mt-1">Level 2</span>
              </div>
            </div>
          </div>
        </div>
      );
  }
};

export default KycVerificationStatus;
