
import { useState } from "react";
import { Upload, X, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface DocumentUploaderProps {
  userId: string;
  documentType: string;
  onUploadComplete: (url: string) => void;
  existingUrl?: string | null;
}

export function DocumentUploader({ userId, documentType, onUploadComplete, existingUrl }: DocumentUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(existingUrl || null);
  const { toast } = useToast();
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      
      // Check file size (max 5MB)
      if (selectedFile.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Maximum file size is 5MB",
          variant: "destructive"
        });
        return;
      }
      
      // Check file type (only images and PDFs)
      const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedTypes.includes(selectedFile.type)) {
        toast({
          title: "Invalid file type",
          description: "Please upload a JPG, PNG or PDF file",
          variant: "destructive"
        });
        return;
      }
      
      setFile(selectedFile);
      
      // If it's an image, create a preview
      if (selectedFile.type.includes('image')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreview(reader.result as string);
        };
        reader.readAsDataURL(selectedFile);
      } else {
        // Use a placeholder for PDFs
        setPreview('/placeholder.svg');
      }
    }
  };
  
  const uploadDocument = async () => {
    if (!file || !userId) return;
    
    try {
      setUploading(true);
      
      // Create the bucket if it doesn't exist
      const { data: buckets } = await supabase.storage.listBuckets();
      const kycBucketExists = buckets?.some(bucket => bucket.name === 'kyc-documents');
      
      if (!kycBucketExists) {
        await supabase.storage.createBucket('kyc-documents', {
          public: false
        });
      }
      
      // Generate a unique file name
      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}/${documentType}_${Date.now()}.${fileExt}`;
      const filePath = `kyc/${fileName}`;
      
      // Upload the file
      const { error: uploadError } = await supabase.storage
        .from('kyc-documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });
        
      if (uploadError) throw uploadError;
      
      // Get the public URL
      const { data } = supabase.storage
        .from('kyc-documents')
        .getPublicUrl(filePath);
        
      const publicUrl = data.publicUrl;
      
      toast({
        title: "Document uploaded successfully",
        description: "Your document has been uploaded and will be reviewed shortly"
      });
      
      // Call the callback with the URL
      onUploadComplete(publicUrl);
      
    } catch (error: any) {
      console.error("Error uploading document:", error);
      toast({
        title: "Upload failed",
        description: error.message || "An error occurred during upload",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };
  
  const removeFile = () => {
    setFile(null);
    setPreview(existingUrl);
  };
  
  return (
    <div>
      {preview ? (
        <div className="border rounded-lg p-2 mb-4">
          <div className="relative">
            <img 
              src={preview} 
              alt="Document preview" 
              className="w-full h-40 object-contain rounded"
            />
            {!uploading && !existingUrl && (
              <Button
                size="icon"
                variant="destructive"
                className="absolute top-2 right-2 h-8 w-8 rounded-full"
                onClick={removeFile}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {existingUrl && (
              <div className="absolute top-2 right-2 bg-green-100 text-green-600 h-8 w-8 rounded-full flex items-center justify-center">
                <Check className="h-4 w-4" />
              </div>
            )}
          </div>
          
          {!existingUrl && file && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground mb-2 truncate">
                {file.name} ({Math.round(file.size / 1024)}KB)
              </p>
              <Button
                onClick={uploadDocument}
                disabled={uploading}
                className="w-full"
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>Upload Document</>
                )}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="border-2 border-dashed rounded-lg p-6 text-center mb-4">
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-4">
            Drag and drop your document here or click to browse
          </p>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              Browse Files
              <Input
                type="file"
                className="sr-only"
                onChange={handleFileChange}
                accept="image/jpeg,image/png,application/pdf"
              />
            </label>
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            JPG, PNG or PDF, max 5MB
          </p>
        </div>
      )}
    </div>
  );
}
