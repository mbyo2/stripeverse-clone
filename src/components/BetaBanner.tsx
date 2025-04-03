
import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

const BetaBanner = () => {
  const [isVisible, setIsVisible] = useState(true);
  
  // Check if the banner was previously dismissed
  useEffect(() => {
    const dismissed = localStorage.getItem("betaBannerDismissed");
    if (dismissed) {
      setIsVisible(false);
    }
  }, []);
  
  const dismissBanner = () => {
    localStorage.setItem("betaBannerDismissed", "true");
    setIsVisible(false);
  };
  
  if (!isVisible) return null;
  
  return (
    <div className="bg-amber-500 text-black py-2 px-4 text-center relative">
      <button 
        onClick={dismissBanner}
        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-black hover:text-gray-700"
        aria-label="Dismiss banner"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="text-sm font-medium">
        <span className="font-bold">BETA</span>: You're using a pre-release version. Please report any issues to our support team.
      </p>
    </div>
  );
};

export default BetaBanner;
