import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { Shield, CheckCircle2, AlertCircle, Upload, Clock } from "lucide-react";
import { supabase, KycMetadata } from "@/integrations/supabase/client";
import KycVerificationStatus, { KycLevel, KycStatus } from "./KycVerificationStatus";

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

// Interface for KYC verification data from database
interface KycVerificationData {
  id: number;
  user_id: string;
  level: string;
  first_name: string | null;
  last_name: string | null;
  id_type: string | null;
  id_number: string | null;
  date_of_birth: string | null;
  address: string | null;
  selfie_url: string | null;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  metadata?: KycMetadata | null;
}

const KycVerification = () => {
  const [kycLevel, setKycLevel] = useState<KycLevel>(KycLevel.NONE);
  const [kycStatus, setKycStatus] = useState<KycStatus>(KycStatus.NOT_STARTED);
  const [rejectionReason, setRejectionReason] = useState<string | undefined>();
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
  const [verificationStarted, setVerificationStarted] = useState(false);
  
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
        
        // Get verification status from database
        const { data: kycData, error: kycError } = await supabase
          .from('kyc_verifications')
          .select('*')
          .eq('user_id', userData.user.id)
          .maybeSingle();
          
        if (kycError && kycError.code !== 'PGRST116') {
          throw kycError;
        }
        
        if (kycData) {
          // Check if verification has been started
          setVerificationStarted(true);
          
          // Set verification status if it exists
          if (kycData.verified_at) {
            setKycStatus(KycStatus.APPROVED);
          } else if (kycData.id_number) {
            setKycStatus(KycStatus.PENDING);
          }
          
          // Set rejection reason if it exists
          if (kycData.metadata) {
            // Type casting the metadata to our KycMetadata type
            const metadata = kycData.metadata as KycMetadata;
            if (metadata.rejection_reason) {
              setRejectionReason(metadata.rejection_reason);
              setKycStatus(KycStatus.REJECTED);
            }
          }
        }
        
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
        // Check if the kyc-documents bucket exists, if not create it
        const { data: buckets } = await supabase.storage.listBuckets();
        const kycBucketExists = buckets?.some(bucket => bucket.name === 'kyc-documents');
        
        if (!kycBucketExists) {
          const { error: bucketError } = await supabase.storage.createBucket('kyc-documents', {
            public: false
          });
          
          if (bucketError) {
            console.error("Error creating KYC documents bucket:", bucketError);
            throw bucketError;
          }
        }
      
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
      
      // Update local KYC level state and status
      setKycLevel(data.level as KycLevel);
      setKycStatus(KycStatus.PENDING);
      setVerificationStarted(true);
      
      toast({
        title: "Verification submitted",
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
        <KycVerificationStatus 
          level={kycLevel} 
          status={kycStatus}
          rejectionReason={rejectionReason}
        />
        
        <Separator className="my-6" />
        
        {/* Hide form if already fully verified */}
        {kycLevel !== KycLevel.FULL && (
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
                    disabled={kycStatus === KycStatus.PENDING}
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
                    disabled={kycStatus === KycStatus.PENDING}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="idType">ID Type</Label>
                  <Select 
                    value={formData.idType}
                    onValueChange={(value) => handleSelectChange('idType', value)}
                    disabled={kycStatus === KycStatus.PENDING}
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
                    disabled={kycStatus === KycStatus.PENDING}
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
                  disabled={kycStatus === KycStatus.PENDING}
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
                  disabled={kycStatus === KycStatus.PENDING}
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
                      {kycStatus !== KycStatus.PENDING && (
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
                      )}
                    </div>
                  ) : (
                    <div className="py-4">
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground mb-2">
                        Upload a clear photo of yourself holding your ID
                      </p>
                      {kycStatus !== KycStatus.PENDING && (
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
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Required for full verification</p>
              </div>
            </div>
            
            {kycStatus === KycStatus.PENDING ? (
              <div className="w-full mt-6 p-4 bg-blue-50 rounded-lg text-center">
                <Clock className="h-5 w-5 mx-auto text-blue-500 mb-2" />
                <p className="text-sm text-blue-700">
                  Your verification is currently being reviewed. 
                  This typically takes 1-2 business days.
                </p>
              </div>
            ) : kycStatus === KycStatus.REJECTED ? (
              <Button type="submit" className="w-full mt-6" disabled={submitting}>
                {submitting ? "Processing..." : "Resubmit Verification"}
              </Button>
            ) : (
              <Button type="submit" className="w-full mt-6" disabled={submitting}>
                {submitting ? "Processing..." : verificationStarted ? "Update Verification" : "Submit Verification"}
              </Button>
            )}
          </form>
        )}
        
        {kycLevel === KycLevel.FULL && (
          <div className="text-center py-6">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <h3 className="text-lg font-medium text-green-800 mb-2">Verification Complete</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your account has been fully verified. You now have access to all features
              and the highest transaction limits available on our platform.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default KycVerification;
