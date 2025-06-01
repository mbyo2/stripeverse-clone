
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { Clock, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const SessionTimeoutWarning = () => {
  const [countdown, setCountdown] = useState(300); // 5 minutes
  const { sessionTimeoutWarning, extendSession, signOut } = useAuth();

  useEffect(() => {
    if (!sessionTimeoutWarning) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          signOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [sessionTimeoutWarning, signOut]);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (!sessionTimeoutWarning) return null;

  return (
    <Dialog open={sessionTimeoutWarning}>
      <DialogContent className="sm:max-w-md">
        <Card className="border-0 shadow-none">
          <CardHeader>
            <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4">
              <Clock className="text-yellow-600 h-6 w-6" />
            </div>
            <CardTitle className="text-center">Session Expiring Soon</CardTitle>
            <CardDescription className="text-center">
              Your session will expire in <span className="font-mono text-lg font-bold text-red-600">
                {formatTime(countdown)}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-yellow-600 h-5 w-5 mt-0.5" />
                <div className="text-sm">
                  <p className="text-yellow-700">
                    For your security, you'll be automatically logged out if no action is taken.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <Button 
                onClick={extendSession}
                className="flex-1"
              >
                Stay Logged In
              </Button>
              <Button 
                variant="outline" 
                onClick={signOut}
                className="flex-1"
              >
                Log Out Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default SessionTimeoutWarning;
