import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { 
  CreditCard, 
  Send, 
  QrCode, 
  History,
  Smartphone,
  Receipt,
  Bitcoin
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const QuickActions = () => {
  const navigate = useNavigate();

  const actions = [
    {
      icon: Send,
      label: "Send",
      description: "Transfer money",
      onClick: () => navigate("/transfer"),
    },
    {
      icon: CreditCard,
      label: "Cards",
      description: "Virtual cards",
      onClick: () => navigate("/wallet"),
    },
    {
      icon: QrCode,
      label: "QR Pay",
      description: "Scan & pay",
      onClick: () => {
        toast("QR payment feature coming soon");
      },
    },
    {
      icon: History,
      label: "History",
      description: "All transactions",
      onClick: () => navigate("/transactions"),
    },
    {
      icon: Smartphone,
      label: "Mobile",
      description: "Top up airtime",
      onClick: () => navigate("/wallet"),
    },
    {
      icon: Receipt,
      label: "Bills",
      description: "Pay utilities",
      onClick: () => navigate("/wallet"),
    },
    {
      icon: Bitcoin,
      label: "Crypto",
      description: "EVM payouts",
      onClick: () => navigate("/wallet/crypto"),
    },
  ];

  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-start justify-center sm:justify-between gap-x-2 gap-y-6 px-1">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <button
              key={index}
              onClick={action.onClick}
              className="flex flex-col items-center text-center w-[76px] sm:w-24 group"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2 group-hover:bg-primary/15 transition-colors">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <span className="text-sm font-medium text-foreground leading-tight">{action.label}</span>
              <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">{action.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default QuickActions;
