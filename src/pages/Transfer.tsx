
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TransferForm from "@/components/TransferForm";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPhoneForDisplay } from "@/lib/utils";

const Transfer = () => {
  const [transferComplete, setTransferComplete] = useState(false);
  const [transferDetails, setTransferDetails] = useState<{
    transferId: string;
    amount: number;
    receiverPhone: string;
  } | null>(null);
  
  const navigate = useNavigate();
  
  // In a real app, you would get this from your auth context
  const currentUser = {
    phone: "0971234567",
    walletBalance: 2450.00
  };
  
  const handleTransferSuccess = (details: {
    transferId: string;
    amount: number;
    receiverPhone: string;
  }) => {
    setTransferDetails(details);
    setTransferComplete(true);
  };
  
  const handleCancel = () => {
    navigate("/wallet");
  };
  
  const handleBackToWallet = () => {
    navigate("/wallet");
  };
  
  const handleNewTransfer = () => {
    setTransferComplete(false);
    setTransferDetails(null);
  };
  
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="max-w-xl mx-auto">
          <h1 className="text-3xl font-bold mb-6">
            {transferComplete ? "Transfer Complete" : "Transfer Money"}
          </h1>
          
          {!transferComplete ? (
            <TransferForm 
              senderPhone={currentUser.phone}
              walletBalance={currentUser.walletBalance}
              onSuccess={handleTransferSuccess}
              onCancel={handleCancel}
            />
          ) : (
            <Card>
              <CardContent className="pt-6 pb-6">
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                  </div>
                  
                  <h2 className="text-2xl font-bold mb-2">Transfer Successful!</h2>
                  <p className="text-muted-foreground mb-6">
                    Your transfer has been processed successfully.
                  </p>
                  
                  <div className="bg-secondary/20 rounded-lg p-4 mb-6 text-left">
                    <div className="grid grid-cols-2 gap-y-3">
                      <span className="text-muted-foreground">Amount:</span>
                      <span className="font-medium text-right">{formatCurrency(transferDetails?.amount || 0)}</span>
                      
                      <span className="text-muted-foreground">Recipient:</span>
                      <span className="font-medium text-right">{formatPhoneForDisplay(transferDetails?.receiverPhone || "")}</span>
                      
                      <span className="text-muted-foreground">Transaction ID:</span>
                      <span className="font-medium text-right">{transferDetails?.transferId}</span>
                      
                      <span className="text-muted-foreground">Date & Time:</span>
                      <span className="font-medium text-right">{new Date().toLocaleString()}</span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3">
                    <Button onClick={handleNewTransfer} className="flex-1">
                      New Transfer
                    </Button>
                    <Button variant="outline" onClick={handleBackToWallet} className="flex-1">
                      Back to Wallet
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Transfer;
