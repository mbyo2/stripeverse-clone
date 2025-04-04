
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2, Upload, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface BusinessLogoProps {
  initialLogo?: string | null;
  onLogoChange: (file: File | null) => void;
  disabled?: boolean;
}

export function BusinessLogo({ 
  initialLogo, 
  onLogoChange, 
  disabled = false 
}: BusinessLogoProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialLogo || null);
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    
    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }
    
    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Logo image must be less than 2MB",
        variant: "destructive",
      });
      return;
    }
    
    // Create a preview URL for the image
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    onLogoChange(file);
    
    toast({
      title: "Logo updated",
      description: "Your business logo has been updated",
    });
  };
  
  const removeLogo = () => {
    setPreviewUrl(null);
    onLogoChange(null);
    
    toast({
      title: "Logo removed",
      description: "Your business logo has been removed",
    });
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      <Avatar className="h-24 w-24 border-2 border-border">
        {previewUrl ? (
          <AvatarImage src={previewUrl} alt="Business logo" />
        ) : (
          <AvatarFallback className="bg-secondary">
            <Building2 className="h-12 w-12 text-muted-foreground" />
          </AvatarFallback>
        )}
      </Avatar>
      
      <div className="flex space-x-2">
        <Button 
          type="button" 
          variant="outline" 
          size="sm" 
          disabled={disabled}
          className="flex items-center"
          asChild
        >
          <label className="cursor-pointer">
            <Upload className="mr-2 h-4 w-4" />
            Upload Logo
            <input
              type="file"
              className="sr-only"
              accept="image/*"
              onChange={handleFileSelect}
              disabled={disabled}
            />
          </label>
        </Button>
        
        {previewUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={removeLogo}
            className="flex items-center text-destructive hover:bg-destructive/10"
          >
            <X className="mr-2 h-4 w-4" />
            Remove
          </Button>
        )}
      </div>
      
      <p className="text-xs text-muted-foreground text-center max-w-xs">
        Upload a square logo image (PNG or JPG) for your business. 
        Maximum file size: 2MB.
      </p>
    </div>
  );
}
