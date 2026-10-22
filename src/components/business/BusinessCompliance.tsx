import { toUserFacingError } from "@/utils/userFacingError";
import React, { useEffect, useRef, useState } from 'react';
import {
  Shield,
  FileCheck,
  Upload,
  CheckCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ComplianceRequirement {
  id: number;
  name: string;
  description: string;
}

// The documents a business must provide. Whether each one has actually been
// submitted is read from the user's real uploads in the kyc-documents
// storage bucket — never assumed.
const REQUIREMENTS: ComplianceRequirement[] = [
  {
    id: 1,
    name: 'Business Registration Documents',
    description: 'Upload your business registration certificate or equivalent documents showing your legal business status.'
  },
  {
    id: 2,
    name: 'Tax Compliance Certificate',
    description: 'Provide your current tax compliance certificate issued by the Zambia Revenue Authority.'
  },
  {
    id: 3,
    name: 'Bank Statement',
    description: 'Upload your last 3 months of business bank statements showing transaction history.'
  },
  {
    id: 4,
    name: 'AML Policy Acknowledgement',
    description: 'Review and acknowledge our Anti-Money Laundering policy for business accounts.'
  },
  {
    id: 5,
    name: 'Director Identification',
    description: 'Provide identification documents for all company directors or business owners.'
  }
];

const BusinessCompliance = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [submittedIds, setSubmittedIds] = useState<Set<number>>(new Set());
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRequirementRef = useRef<number | null>(null);

  useEffect(() => {
    const loadSubmissions = async () => {
      if (!user) return;
      const { data, error } = await supabase.storage
        .from('kyc-documents')
        .list(`business/${user.id}`, { limit: 100 });
      if (error || !data) return;
      const found = new Set<number>();
      data.forEach(file => {
        const match = file.name.match(/^req-(\d+)-/);
        if (match) found.add(Number(match[1]));
      });
      setSubmittedIds(found);
    };
    loadSubmissions();
  }, [user]);

  const submittedCount = REQUIREMENTS.filter(r => submittedIds.has(r.id)).length;
  const submittedPct = Math.round((submittedCount / REQUIREMENTS.length) * 100);

  const handleUploadClick = (requirementId: number) => {
    if (!user) {
      toast({
        title: 'Sign in required',
        description: 'You need to be signed in to upload compliance documents.',
        variant: 'destructive',
      });
      return;
    }
    pendingRequirementRef.current = requirementId;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const requirementId = pendingRequirementRef.current;
    e.target.value = '';
    if (!file || !user || requirementId === null) return;

    try {
      setUploadingId(requirementId);
      const fileExt = file.name.split('.').pop();
      const filePath = `business/${user.id}/req-${requirementId}-${Date.now()}.${fileExt}`;
      const { error } = await supabase.storage
        .from('kyc-documents')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (error) throw error;

      setSubmittedIds(prev => new Set(prev).add(requirementId));
      toast({
        title: 'Document uploaded',
        description: 'Your document has been submitted for review.',
      });
    } catch (error: any) {
      toast({
        title: 'Upload failed',
        description: toUserFacingError(error, 'An error occurred during upload.'),
        variant: 'destructive',
      });
    } finally {
      setUploadingId(null);
      pendingRequirementRef.current = null;
    }
  };

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        onChange={handleFileSelected}
      />
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium flex items-center text-foreground">
            <Shield className="h-5 w-5 text-primary mr-2" />
            Business Compliance Documents
          </h2>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            submittedCount === REQUIREMENTS.length
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
          }`}>
            {submittedCount === REQUIREMENTS.length ? 'All documents submitted' : 'Documents outstanding'}
          </span>
        </div>

        <div className="mb-2 flex justify-between">
          <span className="text-sm text-muted-foreground">Documents submitted</span>
          <span className="text-sm font-medium">{submittedCount} of {REQUIREMENTS.length}</span>
        </div>
        <Progress value={submittedPct} className="h-2" />

        <div className="grid grid-cols-2 gap-4 mt-6 text-center">
          <div className="p-3 bg-secondary/10 rounded-lg">
            <div className="text-2xl font-semibold text-green-600">
              {submittedCount}
            </div>
            <div className="text-sm text-muted-foreground">Submitted</div>
          </div>

          <div className="p-3 bg-secondary/10 rounded-lg">
            <div className="text-2xl font-semibold text-amber-600">
              {REQUIREMENTS.length - submittedCount}
            </div>
            <div className="text-sm text-muted-foreground">Outstanding</div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg">
        <div className="p-6 border-b border-border">
          <h3 className="font-medium">Compliance Requirements</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Submit each document below. Submitted documents are reviewed by our compliance team.
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {REQUIREMENTS.map((req) => {
            const submitted = submittedIds.has(req.id);
            return (
              <AccordionItem key={req.id} value={`item-${req.id}`}>
                <AccordionTrigger className="px-6 py-4">
                  <div className="flex items-center">
                    {submitted ? (
                      <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                    ) : (
                      <FileCheck className="h-5 w-5 text-amber-500 mr-3" />
                    )}
                    <div>
                      <div className="font-medium text-left">{req.name}</div>
                      <div className="text-xs text-muted-foreground text-left">
                        {submitted ? 'Submitted — awaiting review' : 'Not submitted'}
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6 pb-4">
                  <div className="space-y-4">
                    <p className="text-sm">{req.description}</p>

                    <div className="flex space-x-3">
                      <Button
                        size="sm"
                        onClick={() => handleUploadClick(req.id)}
                        disabled={uploadingId === req.id}
                      >
                        <Upload className="h-4 w-4 mr-1" />
                        {uploadingId === req.id
                          ? 'Uploading…'
                          : submitted
                            ? 'Upload New Version'
                            : 'Upload Document'}
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <div className="flex">
          <Shield className="h-5 w-5 text-primary mt-0.5 mr-3 flex-shrink-0" />
          <div>
            <h4 className="font-medium text-foreground mb-1">Need Help With Compliance?</h4>
            <p className="text-sm text-muted-foreground">
              Our compliance team is available to assist you with meeting all regulatory requirements.
              Contact us through the{" "}
              <Link to="/support" className="font-medium text-primary hover:underline">Support Centre</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessCompliance;
