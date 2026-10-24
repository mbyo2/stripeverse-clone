import { Button } from "@/components/ui/button";
import { Receipt } from "lucide-react";
import {
  buildP2pReceiptHtml,
  type P2pReceiptData,
} from "@/utils/p2pUi";

/**
 * One-click trade receipt (§4.3 research amendment): a generated
 * PDF-ready document (order details + counterparty information) for
 * use with banks and police — the document a seller fighting a
 * tainted-fiat account freeze actually needs. Follows the
 * TransactionReceipt print-window pattern; Save-as-PDF is the
 * browser print dialog's own destination. The HTML is built by a
 * pure function that escapes every value (names, notes and
 * references are data, never markup).
 */
export default function P2pReceiptButton({
  data,
  label = "Download receipt",
  variant = "outline",
}: {
  data: P2pReceiptData;
  label?: string;
  variant?: "outline" | "ghost" | "default";
}) {
  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(buildP2pReceiptHtml(data));
    win.document.close();
    win.focus();
    win.print();
  };
  return (
    <Button variant={variant} onClick={handlePrint} className="gap-2">
      <Receipt className="h-4 w-4" />
      {label}
    </Button>
  );
}
