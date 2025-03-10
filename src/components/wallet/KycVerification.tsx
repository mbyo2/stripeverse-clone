
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { Shield, CheckCircle2, AlertCircle, Upload, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// KYC verification levels
enum KycLevel {
  NONE = 'none',
  BASIC = 'basic',
  FULL = 'full'
}

// Interface for form state
interface KycFormState {
  firstName: string;
  lastName: string;
  idType: string;
  idNumber: string;
  dateOfBirth: string;
  address: string;
  selfieImage?: File | null;
}

const KycVerification = () => {
  const [kycLevel, setKycLevel] = useState<KycLevel>(KycLevel.NONE);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<KycFormState>({
    firstName: '',
    lastName: '',
    idType: '',
    idNumber: '',
    dateOfBirth: '',
    address: '',
    selfieImage: null
  });
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  
  const { toast } = useToast();
  
  // Check current KYC level on component mount
  useEffect(() => {
    const checkKycLevel = async () => {
      try {
        setLoading(true);
        
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          toast({
            title: "Authentication required",
            description: "Please log in to verify your identity",
            variant: "destructive"
          });
          return;
        }
        
        // Call our edge function to check KYC level
        const { data, error } = await supabase.functions.invoke('mobile-money', {
          body: {
            paymentMethod: 'check-kyc',
            userId: userData.user.id
          }
        });
        
        if (error) throw error;
        
        setKycLevel(data.level as KycLevel);
        
        // Fetch user profile info to pre-fill the form
        const { data: profileData } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', userData.user.id)
          .single();
          
        if (profileData) {
          setFormData(prev => ({
            ...prev,
            firstName: profileData.first_name || '',
            lastName: profileData.last_name || ''
          }));
        }
        
      } catch (error) {
        console.error("Error checking KYC level:", error);
        toast({
          title: "Error",
          description: "Failed to check verification status",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };
    
    checkKycLevel();
  }, [toast]);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSelfieUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setFormData(prev => ({ ...prev, selfieImage: file }));
      
      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelfiePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setSubmitting(true);
      
      // Get current user
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        toast({
          title: "Authentication required",
          description: "Please log in to verify your identity",
          variant: "destructive"
        });
        return;
      }
      
      // Upload selfie image if provided
      let selfieUrl = null;
      if (formData.selfieImage) {
        const fileName = `kyc/${userData.user.id}/selfie_${Date.now()}.jpg`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('kyc-documents')
          .upload(fileName, formData.selfieImage, {
            cacheControl: '3600',
            upsert: true
          });
          
        if (uploadError) throw uploadError;
        
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('kyc-documents')
          .getPublicUrl(fileName);
          
        selfieUrl = urlData.publicUrl;
      }
      
      // Call our edge function to process KYC verification
      const { data, error } = await supabase.functions.invoke('mobile-money', {
        body: {
          paymentMethod: 'kyc-verification',
          userId: userData.user.id,
          data: {
            ...formData,
            selfieImage: selfieUrl
          }
        }
      });
      
      if (error) throw error;
      
      // Update local KYC level state
      setKycLevel(data.level as KycLevel);
      
      toast({
        title: "Verification update",
        description: data.message,
      });
      
    } catch (error) {
      console.error("KYC submission error:", error);
      toast({
        title: "Verification failed",
        description: "There was a problem processing your verification. Please try again.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };
  
  const renderVerificationStatus = () => {
    switch(kycLevel) {
      case KycLevel.FULL:
        return (
          <div className="bg-green-50 border border-green-100 rounded-lg p-4 flex items-start">
            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-green-800">Fully Verified</h3>
              <p className="text-sm text-green-700">
                Your account has been fully verified. You have access to all features and higher transaction limits.
              </p>
            </div>
          </div>
        );
      case KycLevel.BASIC:
        return (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 flex items-start">
            <Shield className="h-5 w-5 text-amber-500 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-amber-800">Basic Verification</h3>
              <p className="text-sm text-amber-700">
                Your account has basic verification. Complete the full verification process below to increase your transaction limits.
              </p>
            </div>
          </div>
        );
      case KycLevel.NONE:
      default:
        return (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start">
            <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-blue-800">Verification Required</h3>
              <p className="text-sm text-blue-700">
                Verify your identity to unlock higher transaction limits and additional features.
              </p>
            </div>
          </div>
        );
    }
  };
  
  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Clock className="h-6 w-6 text-muted-foreground animate-spin" />
            <span className="ml-2">Loading verification status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity Verification</CardTitle>
        <CardDescription>
          Verify your identity to access higher transaction limits and additional features
        </CardDescription>
      </CardHeader>
      <CardContent>
        {renderVerificationStatus()}
        
        <Separator className="my-6" />
        
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input 
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input 
                  id="lastName"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="idType">ID Type</Label>
                <Select 
                  value={formData.idType}
                  onValueChange={(value) => handleSelectChange('idType', value)}
                >
                  <SelectTrigger id="idType">
                    <SelectValue placeholder="Select ID type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="national_id">National ID</SelectItem>
                    <SelectItem value="passport">Passport</SelectItem>
                    <SelectItem value="drivers_license">Driver's License</SelectItem>
                    <SelectItem value="voter_card">Voter's Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="idNumber">ID Number</Label>
                <Input 
                  id="idNumber"
                  name="idNumber"
                  value={formData.idNumber}
                  onChange={handleInputChange}
                  required
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <Input 
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                value={formData.dateOfBirth}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="address">Physical Address</Label>
              <Input 
                id="address"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                placeholder="Enter your residential address"
              />
              <p className="text-xs text-muted-foreground">Required for full verification</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="selfieUpload">Selfie with ID</Label>
              <div className="border-2 border-dashed rounded-lg p-4 text-center">
                {selfiePreview ? (
                  <div className="space-y-2">
                    <img 
                      src={selfiePreview} 
                      alt="Selfie preview" 
                      className="mx-auto max-h-40 object-contain rounded-lg"
                    />
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        setSelfiePreview(null);
                        setFormData(prev => ({ ...prev, selfieImage: null }));
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <div className="py-4">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Upload a clear photo of yourself holding your ID
                    </p>
                    <Button type="button" variant="outline" size="sm" asChild>
                      <label htmlFor="selfie-upload" className="cursor-pointer">
                        Select Image
                        <input
                          id="selfie-upload"
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={handleSelfieUpload}
                        />
                      </label>
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Required for full verification</p>
            </div>
          </div>
          
          <Button type="submit" className="w-full mt-6" disabled={submitting}>
            {submitting ? "Processing..." : "Submit Verification"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default KycVerification;
