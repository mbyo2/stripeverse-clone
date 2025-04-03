import React, { useState, useEffect } from "react";
import { X, AlertTriangle, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

interface BetaBannerProps {
  expiryDays?: number;
}

const BetaBanner = ({ expiryDays = 7 }: BetaBannerProps) => {
  const [isVisible, setIsVisible] = useState(true);
  
  // Check if the banner was previously dismissed and when
  useEffect(() => {
    const dismissedData = localStorage.getItem("betaBannerDismissed");
    
    if (dismissedData) {
      try {
        const { timestamp } = JSON.parse(dismissedData);
        const dismissedDate = new Date(timestamp);
        const currentDate = new Date();
        
        // Calculate days difference
        const daysDifference = Math.floor(
          (currentDate.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        // If the banner was dismissed less than expiryDays ago, keep it hidden
        if (daysDifference < expiryDays) {
          setIsVisible(false);
        } else {
          // Reset if expiry period has passed
          localStorage.removeItem("betaBannerDismissed");
        }
      } catch (error) {
        // If there's an error parsing the JSON, reset the item
        localStorage.removeItem("betaBannerDismissed");
      }
    }
  }, [expiryDays]);
  
  const dismissBanner = () => {
    // Store dismissal time
    localStorage.setItem(
      "betaBannerDismissed", 
      JSON.stringify({ timestamp: new Date().toISOString() })
    );
    setIsVisible(false);
  };
  
  if (!isVisible) return null;
  
  return (
    <div className="bg-amber-500 text-black py-2 px-4 text-center relative">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        
        <p className="text-sm font-medium flex-1">
          <span className="font-bold">BETA</span>: You're using a pre-release version. Please report any issues to our support team.
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
