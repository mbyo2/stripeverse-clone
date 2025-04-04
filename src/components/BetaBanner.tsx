
import React, { useState, useEffect } from "react";
import { X, AlertTriangle, ExternalLink, Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface BetaBannerProps {
  expiryDays?: number;
  version?: string;
}

const BetaBanner = ({ expiryDays = 7, version = "0.9.0" }: BetaBannerProps) => {
  const [isVisible, setIsVisible] = useState(true);
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const { toast } = useToast();
  
  // Check if the banner was previously dismissed and when
  useEffect(() => {
    const dismissedData = localStorage.getItem("betaBannerDismissed");
    
    if (dismissedData) {
      try {
        const { timestamp, version: dismissedVersion } = JSON.parse(dismissedData);
        const dismissedDate = new Date(timestamp);
        const currentDate = new Date();
        
        // Calculate days difference
        const daysDifference = Math.floor(
          (currentDate.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        // If the banner was dismissed less than expiryDays ago, keep it hidden
        if (daysDifference < expiryDays) {
          setIsVisible(false);
          
          // Check if there's a new version since dismissal
          if (dismissedVersion !== version) {
            setHasNewVersion(true);
            toast({
              title: "New Beta Version Available",
              description: `You've been updated from v${dismissedVersion} to v${version}. Check out what's new!`,
              duration: 5000,
            });
          }
        } else {
          // Reset if expiry period has passed
          localStorage.removeItem("betaBannerDismissed");
        }
      } catch (error) {
        // If there's an error parsing the JSON, reset the item
        localStorage.removeItem("betaBannerDismissed");
      }
    }
  }, [expiryDays, version, toast]);
  
  const dismissBanner = () => {
    // Store dismissal time and current version
    localStorage.setItem(
      "betaBannerDismissed", 
      JSON.stringify({ 
        timestamp: new Date().toISOString(),
        version: version
      })
    );
    setIsVisible(false);
  };

  const showNewVersionNotification = () => {
    toast({
      title: "Beta Version Information",
      description: `You're currently on v${version} of our beta. Thank you for helping us improve!`,
      duration: 3000,
    });
  };
  
  if (!isVisible) {
    // Show a small version indicator in the corner if there's a new version
    if (hasNewVersion) {
      return (
        <div className="fixed bottom-4 right-4 z-50">
          <button 
            onClick={showNewVersionNotification} 
            className="bg-amber-500 text-black p-2 rounded-full shadow-lg hover:bg-amber-400 transition-all"
            aria-label="New beta version available"
            title={`New version v${version} available`}
          >
            <Bell className="h-5 w-5" />
          </button>
        </div>
      );
    }
    return null;
  }
  
  return (
    <div className="bg-amber-500 text-black py-2 px-4 text-center relative">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        
        <p className="text-sm font-medium flex-1">
          <span className="font-bold">BETA v{version}</span>: You're using a pre-release version. Please report any issues to our support team.
        </p>
        
        <div className="flex items-center gap-2">
          <Link 
            to="/feedback" 
            className="text-xs underline flex items-center hover:text-amber-800"
          >
            Submit Feedback
            <ExternalLink className="h-3 w-3 ml-1" />
          </Link>
          
          <button 
            onClick={dismissBanner}
            className="text-black hover:text-gray-700 ml-2"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default BetaBanner;
