import { Card, CardContent } from "@/components/ui/card";
import { 
  CreditCard, 
  Send, 
  QrCode, 
  History,
  Smartphone,
  Receipt
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
        alert("QR payment feature coming soon");
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
  ];

  return (
    <div className="mb-8">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <button
              key={index}
              onClick={action.onClick}
              className="flex flex-col items-center p-4 rounded-xl bg-background border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all duration-200 group"
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2 group-hover:bg-primary/15 transition-colors">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <span className="text-sm font-medium text-foreground">{action.label}</span>
              <span className="text-[10px] text-muted-foreground">{action.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default QuickActions;
