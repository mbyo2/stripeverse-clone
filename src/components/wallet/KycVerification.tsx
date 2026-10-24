
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Shield, CheckCircle2, AlertCircle, Camera, Clock, FileCheck, Loader2 } from "lucide-react";
import { supabase, KycMetadata } from "@/integrations/supabase/client";
import { LiveCameraCapture } from "@/components/identity/LiveCameraCapture";
import KycVerificationStatus, { KycLevel, KycStatus } from "./KycVerificationStatus";
import { DocumentUploader } from "./DocumentUploader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

// Interface for form state
interface KycFormState {
  firstName: string;
  lastName: string;
  idType: string;
  idNumber: string;
  dateOfBirth: string;
  address: string;
  selfieImage?: File | null;
  idFrontUrl?: string | null;
  idBackUrl?: string | null;
  addressDocUrl?: string | null;
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
  id_front_url?: string | null;
  id_back_url?: string | null;
  address_doc_url?: string | null;
}

const KycVerification = () => {
  const [kycLevel, setKycLevel] = useState<KycLevel>(KycLevel.NONE);
  const [kycStatus, setKycStatus] = useState<KycStatus>(KycStatus.NOT_STARTED);
  const [rejectionReason, setRejectionReason] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("personal");
  const [completionPercentage, setCompletionPercentage] = useState(0);
  const [formData, setFormData] = useState<KycFormState>({
    firstName: '',
    lastName: '',
    idType: '',
    idNumber: '',
    dateOfBirth: '',
    address: '',
    selfieImage: null,
    idFrontUrl: null,
    idBackUrl: null,
    addressDocUrl: null
  });
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [selfieCameraOpen, setSelfieCameraOpen] = useState(false);
  const [verificationStarted, setVerificationStarted] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  // Fields the user has actually typed/selected in this session. The
  // mount-time hydration below must never overwrite these — it resolves
  // asynchronously (DB read + an edge-function call) and previously
  // landed AFTER the user started typing, wiping their input back to
  // empty/profile values.
  const dirtyFieldsRef = useRef<Set<string>>(new Set());
  // True once mount hydration has finished; the draft-save effect must
  // not run before this or it would overwrite a saved draft with the
  // empty initial state before the draft is read.
  const hydratedRef = useRef(false);

  const { toast } = useToast();

  // Restore + persist an in-progress draft (sessionStorage, per user).
  // Together with forceMount on the tab panels this guarantees that no
  // step transition — in either direction, and not even a page reload —
  // can throw away personal-info fields, uploaded document URLs, or the
  // user's place in the wizard. The draft is cleared on submit.
  const draftKey = authUserId ? `kyc-draft:${authUserId}` : null;

  useEffect(() => {
    if (!draftKey || !hydratedRef.current) return;
    try {
      const { selfieImage: _file, ...serializable } = formData;
      sessionStorage.setItem(draftKey, JSON.stringify({ form: serializable, activeTab }));
    } catch {
      // Storage full/blocked — the in-memory state still protects the session.
    }
  }, [formData, activeTab, draftKey]);
  
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
        
        setAuthUserId(userData.user.id);

        // Read any in-progress draft saved earlier this session (see
        // the draft-save effect) so a reload or remount resumes exactly
        // where the user left off instead of at empty fields.
        let savedDraft: { form?: Partial<KycFormState>; activeTab?: string } | null = null;
        try {
          const rawDraft = sessionStorage.getItem(`kyc-draft:${userData.user.id}`);
          if (rawDraft) savedDraft = JSON.parse(rawDraft);
        } catch {
          savedDraft = null;
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
        
        // Resume the saved draft first (lowest priority — the stored
        // row below may still override it). Fields the user has already
        // edited during this visit always win.
        if (savedDraft?.form) {
          const draftForm = savedDraft.form;
          setFormData(prev => {
            const next = { ...prev };
            const applyDraft = (key: keyof KycFormState) => {
              const v = draftForm[key];
              if (!dirtyFieldsRef.current.has(key) && typeof v === 'string' && v.length > 0) {
                (next as Record<string, unknown>)[key] = v;
              }
            };
            (['firstName', 'lastName', 'idType', 'idNumber', 'dateOfBirth', 'address', 'idFrontUrl', 'idBackUrl', 'addressDocUrl'] as const).forEach(applyDraft);
            return next;
          });
          if (savedDraft.activeTab === 'documents' || savedDraft.activeTab === 'address') {
            setActiveTab(savedDraft.activeTab);
          }
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
          
          // Set the stored values — but never over a field the user
          // has already edited while this check was in flight (that
          // late overwrite is what made filled-in fields "disappear").
          setFormData(prev => {
            const next = { ...prev };
            const applyStored = (key: keyof KycFormState, value: string | null | undefined) => {
              if (dirtyFieldsRef.current.has(key)) return;
              if (value !== null && value !== undefined && value !== '') {
                (next as Record<string, unknown>)[key] = value;
              }
            };
            applyStored('firstName', kycData.first_name);
            applyStored('lastName', kycData.last_name);
            applyStored('idType', kycData.id_type);
            applyStored('idNumber', kycData.id_number);
            applyStored('dateOfBirth', kycData.date_of_birth);
            applyStored('address', kycData.address);
            applyStored('idFrontUrl', kycData.id_front_url);
            applyStored('idBackUrl', kycData.id_back_url);
            applyStored('addressDocUrl', kycData.address_doc_url);
            return next;
          });
          
          if (kycData.selfie_url) {
            setSelfiePreview(kycData.selfie_url);
          }
        }
        
        // Fetch user profile info to pre-fill the form
        const { data: profileData } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', userData.user.id)
          .single();
          
        if (profileData) {
          // Prefill only fields that are still empty and untouched —
          // never replace something the user has typed.
          setFormData(prev => ({
            ...prev,
            firstName: dirtyFieldsRef.current.has('firstName') ? prev.firstName : (prev.firstName || profileData.first_name || ''),
            lastName: dirtyFieldsRef.current.has('lastName') ? prev.lastName : (prev.lastName || profileData.last_name || '')
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
        hydratedRef.current = true;
        setLoading(false);
      }
    };
    
    checkKycLevel();
  }, [toast]);
  
  // Calculate completion percentage based on form data
  useEffect(() => {
    let complete = 0;
    let total = 0;
    
    // Basic fields
    const basicFields = [
      formData.firstName,
      formData.lastName,
      formData.idType,
      formData.idNumber,
      formData.dateOfBirth
    ];
    
    basicFields.forEach(field => {
      total++;
      if (field && field.length > 0) complete++;
    });
    
    // Document uploads
    const documents = [
      Boolean(selfiePreview),
      Boolean(formData.idFrontUrl),
      Boolean(formData.idBackUrl)
    ];
    
    documents.forEach(doc => {
      total++;
      if (doc) complete++;
    });
    
    // Address info (optional for basic verification)
    if (formData.address && formData.address.length > 0) {
      complete++;
    }
    total++;
    
    // Address document (optional for basic verification)
    if (formData.addressDocUrl) {
      complete++;
    }
    total++;
    
    const percentage = Math.round((complete / total) * 100);
    setCompletionPercentage(percentage);
  }, [formData, selfiePreview]);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    dirtyFieldsRef.current.add(name);
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    dirtyFieldsRef.current.add(name);
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  // The selfie is captured with the live camera ONLY (CEO directive,
  // 2026-10-24): a file upload here would let someone submit a stolen
  // photo of another person. The captured frame becomes the File the
  // submit path uploads — stamped with the genuine capture time —
  // and there is deliberately no file-picker path for this field.
  const handleSelfieCapture = (blob: Blob) => {
    const capturedAt = Date.now();
    const file = new File([blob], `selfie_${capturedAt}.jpg`, {
      type: "image/jpeg",
      lastModified: capturedAt,
    });
    setFormData(prev => ({ ...prev, selfieImage: file }));
    setSelfiePreview(URL.createObjectURL(blob));
    setSelfieCameraOpen(false);
  };
  
  const handleIdFrontUpload = (url: string) => {
    dirtyFieldsRef.current.add('idFrontUrl');
    setFormData(prev => ({ ...prev, idFrontUrl: url }));
  };

  const handleIdBackUpload = (url: string) => {
    dirtyFieldsRef.current.add('idBackUrl');
    setFormData(prev => ({ ...prev, idBackUrl: url }));
  };

  const handleAddressDocUpload = (url: string) => {
    dirtyFieldsRef.current.add('addressDocUrl');
    setFormData(prev => ({ ...prev, addressDocUrl: url }));
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
      
        // The kyc-documents storage policy requires the first path
        // segment to be the owner's auth user id (see DocumentUploader).
        const fileName = `${userData.user.id}/selfie_${Date.now()}.jpg`;
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
            selfieImage: selfieUrl || formData.selfieImage,
            idFrontUrl: formData.idFrontUrl,
            idBackUrl: formData.idBackUrl,
            addressDocUrl: formData.addressDocUrl
          }
        }
      });
      
      if (error) throw error;
      
      // Update local KYC level state and status
      setKycLevel(data.level as KycLevel);
      setKycStatus(KycStatus.PENDING);
      setVerificationStarted(true);

      // The submission has landed — the in-progress draft has served
      // its purpose and must not resurrect stale values next visit.
      if (draftKey) {
        try { sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
      }
      
      // Update the notification context to create a system notification
      await supabase
        .from("notifications")
        .insert({
          user_id: userData.user.id,
          title: "KYC Verification Submitted",
          message: "Your identity verification has been submitted and is being reviewed.",
          type: "system",
          read: false
        });
      
      toast({
        title: "Verification submitted",
        description: data.message,
      });
      
    } catch (error: any) {
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
  
  const getNextTab = () => {
    switch (activeTab) {
      case "personal":
        return "documents";
      case "documents":
        return "address";
      default:
        return "personal";
    }
  };
  
  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
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
          Needed only for specific features — like higher P2P tiers and bigger transaction limits. We'll ask at the time, with the reason.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <KycVerificationStatus 
          level={kycLevel} 
          status={kycStatus}
          rejectionReason={rejectionReason}
        />
        
        {kycStatus === KycStatus.PENDING && (
          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center">
              <Clock className="h-5 w-5 text-blue-500 mr-2" />
              <h3 className="font-medium text-blue-700">Verification In Progress</h3>
            </div>
            <p className="text-sm text-blue-600 mt-1">
              Your verification is being reviewed. This typically takes 1-2 business days.
            </p>
          </div>
        )}
        
        {kycStatus !== KycStatus.APPROVED && kycLevel !== KycLevel.FULL && kycStatus !== KycStatus.PENDING && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">Verification Progress</h3>
              <span className="text-sm text-muted-foreground">{completionPercentage}%</span>
            </div>
            <Progress value={completionPercentage} className="h-2" />
          </div>
        )}
        
        <Separator className="my-6" />
        
        {/* Hide form if already fully verified */}
        {kycLevel !== KycLevel.FULL && kycStatus !== KycStatus.PENDING && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-3 mb-6">
              <TabsTrigger value="personal">Personal Info</TabsTrigger>
              <TabsTrigger value="documents">ID Documents</TabsTrigger>
              <TabsTrigger value="address">Address</TabsTrigger>
            </TabsList>
            
            <form onSubmit={handleSubmit}>
              <TabsContent value="personal" forceMount>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleInputChange}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleInputChange}
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
                          <SelectItem value="national_id">National Registration Card (NRC)</SelectItem>
                          <SelectItem value="passport">Passport</SelectItem>
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
                    />
                  </div>
                  
                  <div className="flex justify-end mt-6">
                    <Button 
                      type="button" 
                      onClick={() => setActiveTab(getNextTab())}
                      className="ml-auto"
                    >
                      Next: Documents
                    </Button>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="documents" forceMount>
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium mb-4">ID Document (Front)</h3>
                    <DocumentUploader 
                      userId={authUserId ?? ''} 
                      documentType="id_front" 
                      onUploadComplete={handleIdFrontUpload} 
                      existingUrl={formData.idFrontUrl} 
                    />
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-medium mb-4">ID Document (Back)</h3>
                    <DocumentUploader 
                      userId={authUserId ?? ''} 
                      documentType="id_back" 
                      onUploadComplete={handleIdBackUpload} 
                      existingUrl={formData.idBackUrl} 
                    />
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-medium mb-4">Selfie with ID</h3>
                    <div className="border-2 border-dashed rounded-lg p-4 text-center">
                      {selfieCameraOpen ? (
                        <div className="text-left">
                          <LiveCameraCapture
                            facingMode="user"
                            captureLabel="Take selfie"
                            onCapture={handleSelfieCapture}
                            onCancel={() => setSelfieCameraOpen(false)}
                          />
                        </div>
                      ) : selfiePreview ? (
                        <div className="space-y-2">
                          <img
                            src={selfiePreview}
                            alt="Selfie preview"
                            className="mx-auto max-h-40 object-contain rounded-lg"
                          />
                          <div className="flex justify-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setSelfieCameraOpen(true)}
                            >
                              Retake
                            </Button>
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
                        </div>
                      ) : (
                        <div className="py-4">
                          <Camera className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                          <p className="text-sm text-muted-foreground mb-2">
                            Take a live photo of yourself holding your ID, using
                            your camera. For your security the photo must be taken
                            now — a saved photo can't be used, so nobody can send
                            a photo of someone else.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSelfieCameraOpen(true)}
                          >
                            <Camera className="mr-2 h-4 w-4" /> Open camera
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex justify-between mt-6">
                    <Button 
                      type="button" 
                      variant="outline"
                      onClick={() => setActiveTab('personal')}
                    >
                      Back
                    </Button>
                    <Button 
                      type="button" 
                      onClick={() => setActiveTab(getNextTab())}
                    >
                      Next: Address
                    </Button>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="address" forceMount>
                <div className="space-y-6">
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
                  
                  <div>
                    <h3 className="text-lg font-medium mb-4">Proof of Address Document</h3>
                    <DocumentUploader 
                      userId={authUserId ?? ''} 
                      documentType="address_proof" 
                      onUploadComplete={handleAddressDocUpload}
                      existingUrl={formData.addressDocUrl}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Upload a utility bill, bank statement, or official document showing your address (less than 3 months old)
                    </p>
                  </div>
                  
                  <div className="flex justify-between mt-6">
                    <Button 
                      type="button" 
                      variant="outline"
                      onClick={() => setActiveTab('documents')}
                    >
                      Back
                    </Button>
                    {/* No HTML `required` on the personal fields above:
                        the tab panels stay mounted (forceMount), and a
                        hidden required field can silently block form
                        submission in some browsers. Completeness is
                        enforced here instead — plus server-side in
                        verifyKyc, which refuses incomplete submissions. */}
                    <Button type="submit" disabled={submitting || !formData.idFrontUrl || !selfiePreview || !formData.firstName || !formData.lastName || !formData.idType || !formData.idNumber || !formData.dateOfBirth}>
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : verificationStarted ? "Update Verification" : "Submit Verification"}
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </form>
          </Tabs>
        )}
        
        {kycLevel === KycLevel.FULL && (
          <div className="text-center py-6">
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <h3 className="text-lg font-medium text-green-800 mb-2">Verification Complete</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Your account has been fully verified, so you're covered for the features
              that ask for verification — and you have the highest transaction limits
              available on our platform.
            </p>
            <div className="mt-6 border border-green-100 rounded-lg p-4 max-w-md mx-auto">
              <h4 className="font-medium text-green-800 mb-2">Your Benefits</h4>
              <ul className="text-sm text-left space-y-2">
                <li className="flex items-center">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                  <span>Increased daily transaction limit of K25,000</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                  <span>Access to international transfers</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                  <span>Reduced transaction fees</span>
                </li>
                <li className="flex items-center">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                  <span>Priority customer support</span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default KycVerification;
