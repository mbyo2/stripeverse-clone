import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import Header from "@/components/Header";
import { TablePageSkeleton } from "@/components/ui/skeletons";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Search } from "lucide-react";
import { listDirectoryUsers } from "@/lib/adminConsole";
import {
  merchantMatchesSearch,
  merchantStatusLabel,
  mergeMerchants,
  type MerchantRow,
  type MerchantView,
} from "@/lib/merchantDirectory";
import { toUserFacingError } from "@/utils/userFacingError";

// Only safe columns are ever selected: never the merchant's raw
// api_key or webhook_secret.
const MERCHANT_COLUMNS =
  "id, user_id, business_name, trading_name, business_type, registration_number, status, mobile_money_enabled, momo_fee_bearer, created_at";

const statusBadgeVariant = (status: string | null) =>
  status === "active"
    ? "default"
    : status === "pending"
      ? "secondary"
      : status === "suspended" || status === "rejected"
        ? "destructive"
        : "outline";

const AdminMerchants = () => {
  const { toast } = useToast();
  const [merchants, setMerchants] = useState<MerchantView[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [merchantRes, directoryRows] = await Promise.all([
        supabase
          .from("merchant_accounts")
          .select(MERCHANT_COLUMNS)
          .order("created_at", { ascending: false }),
        listDirectoryUsers(supabase as never),
      ]);
      if (merchantRes.error) throw merchantRes.error;
      setMerchants(
        mergeMerchants(
          (merchantRes.data || []) as unknown as MerchantRow[],
          directoryRows,
        ),
      );
    } catch (err) {
      console.error(err);
      toast({
        title: "Couldn't load merchants",
        description: toUserFacingError(
          err,
          "We couldn't load the merchant list. Please try again.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = merchants.filter((m) => merchantMatchesSearch(m, search));

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
          <TablePageSkeleton />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <h1 className="text-greeting mb-2">Merchant oversight</h1>
        <p className="text-muted-foreground mb-6">
          Every business on BMaGlass Pay ({merchants.length} in total).
          This is a read-only overview — merchant API keys and webhook
          secrets are never shown here.
        </p>

        <Card>
          <CardHeader>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by business, owner, email, or registration number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent>
            {/* Phone: stacked rows. Tablet and up keep the table. */}
            <div className="divide-y md:hidden">
              {filtered.map((m) => (
                <div key={m.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{m.display_name}</span>
                    <Badge variant={statusBadgeVariant(m.status)}>
                      {merchantStatusLabel(m.status)}
                    </Badge>
                  </div>
                  {m.registered_name && (
                    <span className="block text-sm text-muted-foreground">
                      Registered as {m.registered_name}
                    </span>
                  )}
                  <span className="block truncate text-sm text-muted-foreground">
                    {m.owner_email || "Owner email unavailable"}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Mobile money {m.mobile_money_enabled ? "on" : "off"}
                    {m.created_at
                      ? ` · Joined ${new Date(m.created_at).toLocaleDateString()}`
                      : ""}
                  </span>
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">
                  No merchants found
                </p>
              )}
            </div>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Business</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Mobile money</TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Fee paid by
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        <span className="block">{m.display_name}</span>
                        {m.registered_name && (
                          <span className="block text-xs text-muted-foreground">
                            Registered as {m.registered_name}
                          </span>
                        )}
                        {m.registration_number && (
                          <span className="block text-xs text-muted-foreground">
                            Reg. {m.registration_number}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="block">{m.owner_name || "—"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {m.owner_email || "Unavailable"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(m.status)}>
                          {merchantStatusLabel(m.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {m.mobile_money_enabled ? "On" : "Off"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {m.momo_fee_bearer === "buyer"
                          ? "Buyer"
                          : m.momo_fee_bearer === "seller"
                            ? "Seller"
                            : "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {m.created_at
                          ? new Date(m.created_at).toLocaleDateString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground py-8"
                      >
                        No merchants found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default AdminMerchants;
