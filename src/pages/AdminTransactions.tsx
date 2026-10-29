import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { TablePageSkeleton } from "@/components/ui/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Search, ArrowUpRight, ArrowDownLeft } from "lucide-react";

interface TransactionRow {
  id: number;
  uuid_id: string;
  user_id: string | null;
  amount: number;
  currency: string;
  direction: string;
  status: string;
  payment_method: string;
  recipient_name: string | null;
  created_at: string | null;
  provider: string | null;
}

const AdminTransactions = () => {
  const { formatAmount } = useCurrency();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("transactions")
      .select("id, uuid_id, user_id, amount, currency, direction, status, payment_method, recipient_name, created_at, provider")
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) {
      setTransactions(data);
    }
    setIsLoading(false);
  };

  const filtered = transactions.filter((t) => {
    const matchesSearch =
      !search ||
      (t.recipient_name?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
      t.uuid_id.includes(search);
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    const matchesDir = directionFilter === "all" || t.direction === directionFilter;
    return matchesSearch && matchesStatus && matchesDir;
  });

  const statusColor = (s: string) => {
    switch (s) {
      case "completed": return "default";
      case "pending": return "secondary";
      case "failed": return "destructive";
      default: return "outline";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
          <TablePageSkeleton />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2">Transaction Oversight</h1>
        <p className="text-muted-foreground mb-6">Monitor all platform transactions in real-time.</p>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by recipient or ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={directionFilter} onValueChange={setDirectionFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="incoming">Incoming</SelectItem>
                  <SelectItem value="outgoing">Outgoing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {/* Phone: stacked rows (the 6-column table is wider than a
                phone screen). Tablet and up keep the full table. */}
            <div className="divide-y md:hidden">
              {filtered.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-3">
                  {t.direction === "incoming" ? (
                    <ArrowDownLeft className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {t.recipient_name || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.created_at
                        ? new Date(t.created_at).toLocaleString()
                        : "—"}{" "}
                      · {t.payment_method}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div
                      className={
                        t.direction === "outgoing"
                          ? "text-destructive"
                          : "text-primary"
                      }
                    >
                      {t.direction === "outgoing" ? "-" : "+"}
                      {formatAmount(t.amount)}
                    </div>
                    <Badge variant={statusColor(t.status) as any}>
                      {t.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">
                  No transactions found
                </p>
              )}
            </div>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Direction</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      {t.direction === "incoming" ? (
                        <ArrowDownLeft className="h-4 w-4 text-primary" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-destructive" />
                      )}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate font-medium lg:max-w-none" title={t.recipient_name || undefined}>
                      {t.recipient_name || "—"}
                    </TableCell>
                    <TableCell className={t.direction === "outgoing" ? "text-destructive" : "text-primary"}>
                      {t.direction === "outgoing" ? "-" : "+"}
                      {formatAmount(t.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.payment_method}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusColor(t.status) as any}>{t.status}</Badge>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground text-sm lg:table-cell">
                      {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No transactions found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default AdminTransactions;
