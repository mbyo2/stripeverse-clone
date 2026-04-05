import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

const PageErrorState = ({ 
  title = "Something went wrong", 
  message = "We couldn't load this page. Please try again.",
  onRetry 
}: PageErrorStateProps) => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
    <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
      <AlertTriangle className="h-7 w-7 text-destructive" />
    </div>
    <h3 className="text-lg font-semibold mb-2">{title}</h3>
    <p className="text-muted-foreground mb-6 max-w-md">{message}</p>
    {onRetry && (
      <Button onClick={onRetry} variant="outline" className="gap-2">
        <RefreshCw className="h-4 w-4" /> Try Again
      </Button>
    )}
  </div>
);

export default PageErrorState;
