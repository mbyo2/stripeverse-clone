
import { Card, CardContent } from "@/components/ui/card";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

const mockTransactions = [
  { id: 1, type: 'outgoing', recipient: 'John Banda', date: 'Oct 15, 2023', amount: 250.75 },
  { id: 2, type: 'incoming', recipient: 'Mary Phiri', date: 'Oct 14, 2023', amount: 320.50 },
  { id: 3, type: 'outgoing', recipient: 'Zamtel', date: 'Oct 13, 2023', amount: 100.00 },
  { id: 4, type: 'incoming', recipient: 'MTN Mobile', date: 'Oct 12, 2023', amount: 500.25 },
  { id: 5, type: 'outgoing', recipient: 'Airtel Money', date: 'Oct 11, 2023', amount: 150.00 },
];

const TransactionHistory = () => {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-4">
          {mockTransactions.map((transaction) => (
            <div key={transaction.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  transaction.type === 'outgoing' ? "bg-red-100" : "bg-green-100"
                }`}>
                  {transaction.type === 'outgoing' ? (
                    <ArrowUpRight className="h-5 w-5 text-red-600" />
                  ) : (
                    <ArrowDownLeft className="h-5 w-5 text-green-600" />
                  )}
                </div>
                <div className="ml-4">
                  <div className="font-medium">
                    {transaction.type === 'outgoing' ? "Sent to" : "Received from"} {" "}
                    {transaction.recipient}
                  </div>
                  <div className="text-sm text-muted-foreground">{transaction.date}</div>
                </div>
              </div>
              <div className={`font-medium ${transaction.type === 'outgoing' ? "text-red-600" : "text-green-600"}`}>
                {transaction.type === 'outgoing' ? "-" : "+"}K {transaction.amount.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default TransactionHistory;
