import { toUserFacingError } from "@/utils/userFacingError";

import { useEffect, useState } from "react";
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

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB
const PREPARABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Neutral inline document glyph (no external placeholder asset), used for
// PDF previews and as the fallback whenever a stored document cannot be
// rendered as an image.
const DOCUMENT_GLYPH_PREVIEW = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><path d='M9 13h6'/><path d='M9 17h6'/></svg>";

/**
 * Extract the storage object path from a stored kyc-documents URL (the
 * portion after `/kyc-documents/`), or null when the URL does not belong
 * to that bucket.
 */
function kycStoragePath(url: string): string | null {
  const marker = '/kyc-documents/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const raw = url.slice(idx + marker.length).split(/[?#]/)[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Synchronous first display value for a stored document: non-bucket URLs
 * are used as-is; bucket documents start from the neutral glyph (PDFs keep
 * it permanently — an <img> cannot render a PDF) until the effect below
 * swaps in a signed URL.
 */
function initialStoredPreview(url?: string | null): string | null {
  if (!url) return null;
  if (kycStoragePath(url) === null) return url;
  return DOCUMENT_GLYPH_PREVIEW;
}

/**
 * Prepare a phone photo for upload: decode it, downscale so the longest
 * edge is at most 2048px, and re-encode as JPEG (quality 0.85). Returns
 * the prepared file only when it is smaller than the original. Any
 * failure (e.g. a format the browser cannot decode, such as HEIC on
 * some browsers) falls back to the original file untouched.
 */
async function prepareImageForUpload(file: File): Promise<File> {
  if (!PREPARABLE_IMAGE_TYPES.includes(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longestEdge > 2048 ? 2048 / longestEdge : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    );
    if (!blob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'document';
    const prepared = new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
    return prepared.size < file.size ? prepared : file;
  } catch {
    return file;
  }
}

export function DocumentUploader({ userId, documentType, onUploadComplete, existingUrl }: DocumentUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  // Preview of a freshly selected local file (FileReader data URL or the
  // PDF glyph). Takes precedence over the stored-document preview.
  const [preview, setPreview] = useState<string | null>(null);
  // Display URL for the document already on file. The kyc-documents
  // bucket is PRIVATE, so the stored public-style URL cannot be read back
  // (it returns HTTP 400 without auth) and rendered as a broken image on
  // every revisit. Stored bucket documents are therefore displayed via a
  // short-lived signed URL; the stored value itself is unchanged.
  const [storedPreview, setStoredPreview] = useState<string | null>(() => initialStoredPreview(existingUrl));
  const { toast } = useToast();

  useEffect(() => {
    setStoredPreview(initialStoredPreview(existingUrl));
    if (!existingUrl) return;
    const path = kycStoragePath(existingUrl);
    if (path === null) return; // not a bucket document — shown as-is
    if (path.toLowerCase().endsWith('.pdf')) return; // glyph is the preview
    let cancelled = false;
    supabase.storage
      .from('kyc-documents')
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.signedUrl) {
          setStoredPreview(data.signedUrl);
        }
        // On any failure the neutral glyph from initialStoredPreview
        // stays — the document is on file (green tick), never a broken img.
      })
      .catch(() => {
        // Keep the glyph placeholder; see above.
      });
    return () => {
      cancelled = true;
    };
  }, [existingUrl]);

  const shownPreview = preview ?? storedPreview;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      
      // Check file type (only images and PDFs)
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
      if (!allowedTypes.includes(selectedFile.type)) {
        toast({
          title: "Invalid file type",
          description: "Please upload a JPG, PNG, HEIC or PDF file",
          variant: "destructive"
        });
        return;
      }
      
      // Check file size (max 10MB). Decodable images are resized before
      // upload, so their size is checked after preparation in
      // uploadDocument; everything else is checked as-is here.
      if (!PREPARABLE_IMAGE_TYPES.includes(selectedFile.type) && selectedFile.size > MAX_UPLOAD_SIZE) {
        toast({
          title: "File too large",
          description: "Maximum file size is 10MB",
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
        // Neutral inline document glyph for PDFs (no external placeholder asset)
        setPreview(DOCUMENT_GLYPH_PREVIEW);
      }
    }
  };
  
  const uploadDocument = async () => {
    if (!file || !userId) return;
    
    try {
      setUploading(true);
      
      // Resize phone photos before upload so large camera images fit
      // comfortably; falls back to the original file when the browser
      // cannot decode it (e.g. HEIC) or resizing would not help.
      const fileToUpload = await prepareImageForUpload(file);
      
      // The 10MB cap applies to the file as prepared.
      if (fileToUpload.size > MAX_UPLOAD_SIZE) {
        toast({
          title: "File too large",
          description: "Maximum file size is 10MB",
          variant: "destructive"
        });
        return;
      }
      
      // Generate a unique file name. The storage policy for the
      // kyc-documents bucket requires the FIRST path segment to be the
      // owner's auth user id ((storage.foldername(name))[1] = auth.uid()),
      // and the parent passes exactly that as `userId` — so the path must
      // start with it. The old `kyc/<id-number>/…` prefix failed the
      // policy on every upload and no document ever landed.
      const fileExt = fileToUpload.name.split('.').pop();
      const filePath = `${userId}/${documentType}_${Date.now()}.${fileExt}`;
      
      // Upload the file. The kyc-documents bucket is provisioned by
      // migration; clients upload directly to it.
      const { error: uploadError } = await supabase.storage
        .from('kyc-documents')
        .upload(filePath, fileToUpload, {
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
        description: toUserFacingError(error, "An error occurred during upload"),
        variant: "destructive"
      });
    } finally {
      setUploading(false);
    }
  };
  
  const removeFile = () => {
    setFile(null);
    // Fall back to the stored-document preview (signed URL or glyph),
    // resolved from existingUrl — never the raw stored URL itself.
    setPreview(null);
  };
  
  return (
    <div>
      {shownPreview ? (
        <div className="border rounded-lg p-2 mb-4">
          <div className="relative">
            <img
              src={shownPreview}
              alt="Document preview" 
              className="w-full h-40 object-contain rounded"
            />
            {!uploading && !existingUrl && (
              <Button
                type="button"
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
                type="button"
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
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              />
            </label>
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            JPG, PNG, HEIC or PDF, max 10MB · photos are resized automatically
          </p>
        </div>
      )}
    </div>
  );
}
