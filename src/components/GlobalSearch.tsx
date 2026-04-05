import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, ArrowRight, CreditCard, Users, FileText, ArrowLeftRight, Wallet, Settings, BarChart3, Shield } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";

interface SearchResult {
  type: "transaction" | "contact" | "invoice" | "page";
  id: string;
  title: string;
  subtitle: string;
  path: string;
}

const PAGES: SearchResult[] = [
  { type: "page", id: "dashboard", title: "Dashboard", subtitle: "Overview", path: "/dashboard" },
  { type: "page", id: "wallet", title: "Wallet", subtitle: "Balance & cards", path: "/wallet" },
  { type: "page", id: "transactions", title: "Transactions", subtitle: "Transaction history", path: "/transactions" },
  { type: "page", id: "transfer", title: "Transfer Money", subtitle: "Send & request", path: "/transfer" },
  { type: "page", id: "contacts", title: "Contacts", subtitle: "Saved recipients", path: "/contacts" },
  { type: "page", id: "invoices", title: "Invoices", subtitle: "Create & manage", path: "/invoices" },
  { type: "page", id: "settings", title: "Settings", subtitle: "Account settings", path: "/settings" },
  { type: "page", id: "analytics", title: "Analytics", subtitle: "Business analytics", path: "/analytics" },
  { type: "page", id: "security", title: "Security Settings", subtitle: "2FA, sessions", path: "/security-settings" },
  { type: "page", id: "cards", title: "Virtual Cards", subtitle: "Create & manage", path: "/card/new" },
  { type: "page", id: "billing", title: "Billing", subtitle: "Subscription & plans", path: "/billing" },
  { type: "page", id: "qr", title: "QR Payments", subtitle: "Scan & pay", path: "/qr-payments" },
  { type: "page", id: "statements", title: "Statements", subtitle: "Export CSV/PDF", path: "/statements" },
  { type: "page", id: "savings", title: "Savings", subtitle: "Savings goals", path: "/savings" },
  { type: "page", id: "rewards", title: "Rewards", subtitle: "Points & tiers", path: "/rewards" },
];

const typeIcon = (type: string) => {
  switch (type) {
    case "transaction": return <ArrowLeftRight className="h-4 w-4" />;
    case "contact": return <Users className="h-4 w-4" />;
    case "invoice": return <FileText className="h-4 w-4" />;
    default: return <ArrowRight className="h-4 w-4" />;
  }
};

const typeBadge = (type: string) => {
  const colors: Record<string, string> = {
    transaction: "bg-primary/10 text-primary",
    contact: "bg-success/10 text-success",
    invoice: "bg-warning/10 text-warning",
    page: "bg-muted text-muted-foreground",
  };
  return <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${colors[type] || ""}`}>{type}</Badge>;
};

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GlobalSearch = ({ open, onOpenChange }: GlobalSearchProps) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const q = query.toLowerCase();
    const pageResults = PAGES.filter(
      (p) => p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q)
    );

    setResults(pageResults);

    if (!user || q.length < 2) return;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const [txRes, contactRes, invoiceRes] = await Promise.all([
          supabase
            .from("transactions")
            .select("uuid_id, recipient_name, amount, currency, created_at, reference")
            .eq("user_id", user.id)
            .or(`recipient_name.ilike.%${q}%,reference.ilike.%${q}%,description.ilike.%${q}%`)
            .limit(5),
          supabase
            .from("saved_contacts")
            .select("id, contact_name, phone_number, email")
            .eq("user_id", user.id)
            .or(`contact_name.ilike.%${q}%,phone_number.ilike.%${q}%,email.ilike.%${q}%`)
            .limit(5),
          supabase
            .from("merchant_invoices")
            .select("id, invoice_number, customer_name, customer_email, total_amount")
            .eq("merchant_id", user.id)
            .or(`invoice_number.ilike.%${q}%,customer_name.ilike.%${q}%,customer_email.ilike.%${q}%`)
            .limit(5),
        ]);

        const dbResults: SearchResult[] = [
          ...(txRes.data || []).map((t) => ({
            type: "transaction" as const,
            id: t.uuid_id,
            title: t.recipient_name || "Transaction",
            subtitle: `${t.currency} ${t.amount} · ${t.reference || ""}`,
            path: "/transactions",
          })),
          ...(contactRes.data || []).map((c) => ({
            type: "contact" as const,
            id: c.id,
            title: c.contact_name,
            subtitle: c.phone_number || c.email || "",
            path: "/contacts",
          })),
          ...(invoiceRes.data || []).map((i) => ({
            type: "invoice" as const,
            id: i.id,
            title: i.invoice_number || "Invoice",
            subtitle: `${i.customer_name || i.customer_email} · ${i.total_amount}`,
            path: "/invoices",
          })),
        ];

        setResults([...pageResults, ...dbResults]);
      } catch {
        // keep page results only
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, user]);

  const handleSelect = (result: SearchResult) => {
    onOpenChange(false);
    navigate(result.path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <div className="flex items-center border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            placeholder="Search transactions, contacts, invoices, pages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 focus-visible:ring-0 h-12 text-sm"
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {!query && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Type to search across your account...
            </div>
          )}
          {query && results.length === 0 && !loading && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          )}
          {results.map((result) => (
            <button
              key={`${result.type}-${result.id}`}
              onClick={() => handleSelect(result)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                {typeIcon(result.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{result.title}</p>
                <p className="text-xs text-muted-foreground truncate">{result.subtitle}</p>
              </div>
              {typeBadge(result.type)}
            </button>
          ))}
          {loading && (
            <div className="p-4 text-center text-xs text-muted-foreground">Searching...</div>
          )}
        </div>
        <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>⌘K to toggle</span>
          <span>↵ to select</span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GlobalSearch;
