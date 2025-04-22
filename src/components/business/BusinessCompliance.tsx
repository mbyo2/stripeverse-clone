
import React, { useState } from 'react';
import { 
  Shield, 
  FileCheck, 
  AlertTriangle, 
  ChevronRight, 
  Download, 
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

interface ComplianceRequirement {
  id: number;
  name: string;
  description: string;
  status: 'pending' | 'completed' | 'rejected';
  dueDate?: string;
  documentLink?: string;
}

const BusinessCompliance = () => {
  const { toast } = useToast();
  const [complianceScore, setComplianceScore] = useState(65);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([
    {
      id: 1,
      name: 'Business Registration Documents',
      description: 'Upload your business registration certificate or equivalent documents showing your legal business status.',
      status: 'completed',
      dueDate: '2024-04-01'
    },
    {
      id: 2,
      name: 'Tax Compliance Certificate',
      description: 'Provide your current tax compliance certificate issued by the Zambia Revenue Authority.',
      status: 'pending',
      dueDate: '2024-05-01',
      documentLink: '/documents/tax-compliance-form.pdf'
    },
    {
      id: 3,
      name: 'Bank Statement',
      description: 'Upload your last 3 months of business bank statements showing transaction history.',
      status: 'completed',
      dueDate: '2024-04-01'
    },
    {
      id: 4,
      name: 'AML Policy Acknowledgement',
      description: 'Review and acknowledge our Anti-Money Laundering policy for business accounts.',
      status: 'pending',
      dueDate: '2024-05-15',
      documentLink: '/documents/aml-policy.pdf'
    },
    {
      id: 5,
      name: 'Director Identification',
      description: 'Provide identification documents for all company directors or business owners.',
      status: 'rejected',
      dueDate: '2024-04-10'
    }
  ]);

  const handleDownloadDocument = (documentName: string) => {
    toast({
      title: 'Document Download',
      description: `${documentName} template would be downloaded in a real implementation.`,
    });
  };

  const handleUploadDocument = (requirementId: number) => {
    // Mock file upload functionality
    toast({
      title: 'Document Uploaded',
      description: 'Your document has been submitted for review.',
    });
    
    // Update requirement status
    setRequirements(prevReqs => 
      prevReqs.map(req => 
        req.id === requirementId 
          ? { ...req, status: 'pending' } 
          : req
      )
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium flex items-center">
            <Shield className="h-5 w-5 text-primary mr-2" />
            Business Compliance Status
          </h2>
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
            complianceScore >= 80 ? 'bg-green-100 text-green-800' :
            complianceScore >= 50 ? 'bg-amber-100 text-amber-800' :
            'bg-red-100 text-red-800'
          }`}>
            {complianceScore >= 80 ? 'Fully Compliant' :
             complianceScore >= 50 ? 'Partially Compliant' :
             'Non-Compliant'}
          </span>
        </div>

        <div className="mb-2 flex justify-between">
          <span className="text-sm text-gray-600">Compliance Score</span>
          <span className="text-sm font-medium">{complianceScore}%</span>
        </div>
        <Progress value={complianceScore} className="h-2" />

        <div className="grid grid-cols-3 gap-4 mt-6 text-center">
          <div className="p-3 bg-secondary/10 rounded-lg">
            <div className="text-2xl font-semibold text-green-600">
              {requirements.filter(r => r.status === 'completed').length}
            </div>
            <div className="text-sm text-muted-foreground">Completed</div>
          </div>
          
          <div className="p-3 bg-secondary/10 rounded-lg">
            <div className="text-2xl font-semibold text-amber-600">
              {requirements.filter(r => r.status === 'pending').length}
            </div>
            <div className="text-sm text-muted-foreground">Pending</div>
          </div>
          
          <div className="p-3 bg-secondary/10 rounded-lg">
            <div className="text-2xl font-semibold text-red-600">
              {requirements.filter(r => r.status === 'rejected').length}
            </div>
            <div className="text-sm text-muted-foreground">Rejected</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-border rounded-lg">
        <div className="p-6 border-b border-border">
          <h3 className="font-medium">Compliance Requirements</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Complete all requirements to ensure full regulatory compliance.
          </p>
        </div>
        
        <Accordion type="single" collapsible className="w-full">
          {requirements.map((req) => (
            <AccordionItem key={req.id} value={`item-${req.id}`}>
              <AccordionTrigger className="px-6 py-4">
                <div className="flex items-center">
                  {req.status === 'completed' ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mr-3" />
                  ) : req.status === 'rejected' ? (
                    <AlertTriangle className="h-5 w-5 text-red-500 mr-3" />
                  ) : (
                    <FileCheck className="h-5 w-5 text-amber-500 mr-3" />
                  )}
                  <div>
                    <div className="font-medium text-left">{req.name}</div>
                    <div className="text-xs text-muted-foreground text-left">
                      Due: {req.dueDate}
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-4">
                <div className="space-y-4">
                  <p className="text-sm">{req.description}</p>
                  
                  {req.status === 'rejected' && (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 text-sm text-red-700">
                      <strong>Rejected:</strong> Document does not meet our requirements. 
                      Please ensure all pages are clearly visible and the document is current.
                    </div>
                  )}
                  
                  <div className="flex space-x-3">
                    {req.documentLink && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleDownloadDocument(req.name)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Template
                      </Button>
                    )}
                    
                    {req.status !== 'completed' && (
                      <Button 
                        size="sm"
                        onClick={() => handleUploadDocument(req.id)}
                      >
                        <Upload className="h-4 w-4 mr-1" />
                        Upload Document
                      </Button>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
      
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
        <div className="flex">
          <Shield className="h-5 w-5 text-blue-500 mt-0.5 mr-3 flex-shrink-0" />
          <div>
            <h4 className="font-medium text-blue-800 mb-1">Need Help With Compliance?</h4>
            <p className="text-sm text-blue-700">
              Our compliance team is available to assist you with meeting all regulatory requirements.
              Contact us at <span className="font-medium">compliance@bmaglasspay.com</span> or 
              call <span className="font-medium">+260 976 123 456</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessCompliance;
