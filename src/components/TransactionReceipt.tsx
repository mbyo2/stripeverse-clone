import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Receipt, Download, Printer } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { format } from "date-fns";
import { useRef } from "react";

interface TransactionReceiptProps {
  transaction: {
    uuid_id?: string;
    id?: string;
    recipient_name?: string;
    amount: number;
    currency: string;
    status: string;
    direction?: string;
    created_at: string;
    reference?: string;
    description?: string;
    fee_amount?: number;
    category?: string;
    payment_method?: string;
  };
  trigger?: React.ReactNode;
}

const TransactionReceipt = ({ transaction, trigger }: TransactionReceiptProps) => {
  const { formatAmount } = useCurrency();
  const receiptRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const content = receiptRef.current;
    if (!content) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>Receipt</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 400px; margin: 40px auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 24px; }
        .logo { font-size: 20px; font-weight: bold; color: #0070ba; }
        .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .label { color: #666; font-size: 14px; }
        .value { font-weight: 500; font-size: 14px; }
        .total { font-size: 24px; font-weight: bold; text-align: center; margin: 20px 0; }
        .footer { text-align: center; color: #999; font-size: 12px; margin-top: 32px; }
        @media print { body { margin: 0; } }
      </style></head><body>
        <div class="header"><div class="logo">BMaGlass Pay</div><p>Transaction Receipt</p></div>
        <div class="total">${transaction.direction === 'outgoing' ? '-' : '+'}${formatAmount(transaction.amount)}</div>
        <div class="row"><span class="label">Status</span><span class="value">${transaction.status}</span></div>
        <div class="row"><span class="label">Recipient</span><span class="value">${transaction.recipient_name || 'N/A'}</span></div>
        <div class="row"><span class="label">Date</span><span class="value">${format(new Date(transaction.created_at), 'MMM d, yyyy HH:mm')}</span></div>
        ${transaction.reference ? `<div class="row"><span class="label">Reference</span><span class="value">${transaction.reference}</span></div>` : ''}
        ${transaction.fee_amount ? `<div class="row"><span class="label">Fee</span><span class="value">${formatAmount(transaction.fee_amount)}</span></div>` : ''}
        ${transaction.category ? `<div class="row"><span class="label">Category</span><span class="value">${transaction.category}</span></div>` : ''}
        ${transaction.payment_method ? `<div class="row"><span class="label">Method</span><span class="value">${transaction.payment_method}</span></div>` : ''}
        <div class="row"><span class="label">ID</span><span class="value" style="font-family:monospace;font-size:11px">${(transaction.uuid_id || transaction.id || '').substring(0, 12)}...</span></div>
        <div class="footer"><p>Thank you for using BMaGlass Pay</p><p>This is an electronic receipt</p></div>
      </body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Receipt className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" /> Transaction Receipt
          </DialogTitle>
        </DialogHeader>
        <div ref={receiptRef} className="space-y-4">
          <div className="text-center py-4">
            <p className="text-3xl font-bold">
              {transaction.direction === "outgoing" ? "-" : "+"}
              {formatAmount(transaction.amount)}
            </p>
            <p className="text-sm text-muted-foreground mt-1 capitalize">{transaction.status}</p>
          </div>
          <Separator />
          <div className="space-y-3">
            {[
              ["Recipient", transaction.recipient_name],
              ["Date", format(new Date(transaction.created_at), "MMM d, yyyy HH:mm")],
              ["Reference", transaction.reference],
              ["Fee", transaction.fee_amount ? formatAmount(transaction.fee_amount) : null],
              ["Category", transaction.category],
              ["Method", transaction.payment_method],
              ["ID", (transaction.uuid_id || transaction.id || "").substring(0, 12) + "..."],
            ]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div key={label as string} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{value}</span>
                </div>
              ))}
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Button onClick={handlePrint} className="flex-1 gap-2">
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TransactionReceipt;
