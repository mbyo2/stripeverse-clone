
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  CreditCard, 
  Send, 
  QrCode, 
  History,
  PlusCircle,
  ArrowUpRight
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const QuickActions = () => {
  const navigate = useNavigate();

  const actions = [
    {
      icon: Send,
      label: "Send Money",
      description: "Transfer to friends & family",
      onClick: () => navigate("/transfer"),
      color: "bg-green-500 hover:bg-green-600",
    },
    {
      icon: CreditCard,
      label: "Virtual Cards",
      description: "Manage your cards",
      onClick: () => navigate("/wallet"),
      color: "bg-purple-500 hover:bg-purple-600",
    },
    {
      icon: QrCode,
      label: "QR Pay",
      description: "Scan to pay or receive",
      onClick: () => {
        // QR Pay functionality - coming soon
        alert("QR payment feature coming soon");
      },
      color: "bg-blue-500 hover:bg-blue-600",
    },
    {
      icon: History,
      label: "Transactions",
      description: "View transaction history",
      onClick: () => navigate("/transactions"),
      color: "bg-orange-500 hover:bg-orange-600",
    },
  ];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center">
          <PlusCircle className="mr-2 h-5 w-5" />
          Quick Actions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <Button
                key={index}
                variant="outline"
                className={`h-20 flex-col space-y-2 hover:text-white transition-all duration-200 ${action.color}`}
                onClick={action.onClick}
              >
                <Icon className="h-6 w-6" />
                <div className="text-center">
                  <div className="font-medium text-sm">{action.label}</div>
                  <div className="text-xs opacity-70">{action.description}</div>
                </div>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default QuickActions;
