
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownLeft, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";

interface WalletBalanceProps {
  onSendMoney: () => void;
  onReceiveMoney: () => void;
}

const WalletBalance = ({ onSendMoney, onReceiveMoney }: WalletBalanceProps) => {
  const { wallet, isLoading } = useWallet();

  if (isLoading) {
    return (
      <Card className="mb-8 bg-gradient-to-br from-blue-500 to-blue-600 text-white">
        <CardContent className="p-6 animate-pulse">
          <div className="h-6 w-32 bg-white/20 rounded mb-4"></div>
          <div className="h-10 w-48 bg-white/20 rounded mb-4"></div>
          <div className="flex space-x-4">
            <div className="h-10 w-20 bg-white/20 rounded"></div>
            <div className="h-10 w-20 bg-white/20 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-8 bg-gradient-to-br from-blue-500 to-blue-600 text-white transform hover:scale-105 transition-all duration-300">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium opacity-90 flex items-center">
          <Wallet className="mr-2 h-4 w-4" />
          Available Balance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-4xl font-bold mb-4">
          {formatCurrency(wallet?.balance || 0)}
        </div>
        <div className="flex space-x-4">
          <Button 
            onClick={onSendMoney} 
            variant="secondary" 
            className="flex-1 hover:bg-white hover:text-blue-600"
          >
            <ArrowUpRight className="mr-2 h-4 w-4" /> Send
          </Button>
          <Button 
            onClick={onReceiveMoney} 
            variant="secondary" 
            className="flex-1 hover:bg-white hover:text-blue-600"
          >
            <ArrowDownLeft className="mr-2 h-4 w-4" /> Receive
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default WalletBalance;
