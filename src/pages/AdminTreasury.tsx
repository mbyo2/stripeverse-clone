import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonStatCardsRow, SkeletonTableRows } from "@/components/ui/skeletons";
import {
  Landmark,
  ShieldAlert,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import {
  TREASURY_PRESETS,
  categoryLabel,
  feeRailLabel,
  formatFeeAmount,
  formatMoney,
  formatSatsAmount,
  isSuperAdminRefusal,
  periodRange,
  buildTreasuryCsv,
  fetchTreasuryOverview,
  fetchTreasuryReport,
  fetchBankPayoutLiabilities,
  CSV_EXPORT_LIMIT,
  type BankPayoutLiabilities,
  type TreasuryOverview,
  type TreasuryPreset,
  type TreasuryReport,
  type TreasuryReportFilters,
} from "@/utils/treasury";

const PAGE_SIZE = 25;

const CURRENCY_OPTIONS = ["ZMW", "USD", "BTC", "EUR", "GBP"];
const STATUS_OPTIONS = ["completed", "pending", "failed", "cancelled", "refunded"];

const AdminTreasury = () => {
  const { toast } = useToast();

  const [preset, setPreset] = useState<TreasuryPreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(
    () => periodRange(preset, new Date(), { from: customFrom, to: customTo }),
    // Re-resolve when the preset or the custom dates change. The
    // window's end is "now", so it is intentionally not reactive to
    // the clock beyond those changes + manual refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset, customFrom, customTo],
  );

  const [overview, setOverview] = useState<TreasuryOverview | null>(null);
  const [overviewState, setOverviewState] = useState<
    "loading" | "ready" | "refused" | "error"
  >("loading");
  const [refreshTick, setRefreshTick] = useState(0);

  const loadOverview = useCallback(async () => {
    setOverviewState((s) => (s === "ready" ? s : "loading"));
    try {
      const data = await fetchTreasuryOverview(range);
      setOverview(data);
      setOverviewState("ready");
    } catch (error) {
      if (isSuperAdminRefusal(error)) {
        setOverviewState("refused");
      } else {
        console.error("Treasury overview failed:", error);
        setOverviewState("error");
      }
    }
  }, [range]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview, refreshTick]);

  // Bank-payout liabilities (migration 20261245): reserved user
  // money owed out to banks. A failure here never blocks the rest
  // of the console — the card simply doesn't render.
  const [bankLiabilities, setBankLiabilities] = useState<BankPayoutLiabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchBankPayoutLiabilities()
      .then((data) => {
        if (!cancelled) setBankLiabilities(data);
      })
      .catch(() => {
        if (!cancelled) setBankLiabilities(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // ---- Report -------------------------------------------------------
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [direction, setDirection] = useState("all");
  const [page, setPage] = useState(0);
  const [report, setReport] = useState<TreasuryReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter or period change restarts pagination.
  useEffect(() => {
    setPage(0);
  }, [search, currency, category, status, direction, range]);

  const filters: TreasuryReportFilters = useMemo(
    () => ({
      currency: currency === "all" ? null : currency,
      category: category === "all" ? null : category,
      status: status === "all" ? null : status,
      direction: direction === "all" ? null : direction,
      search: search || null,
    }),
    [currency, category, status, direction, search],
  );

  const loadReport = useCallback(async () => {
    if (overviewState !== "ready") return;
    setReportLoading(true);
    try {
      const data = await fetchTreasuryReport(range, filters, PAGE_SIZE, page * PAGE_SIZE);
      setReport(data);
    } catch (error) {
      console.error("Treasury report failed:", error);
      toast({
        title: "Report unavailable",
        description: "We couldn't load the transaction report. Please try again.",
        variant: "destructive",
      });
    } finally {
      setReportLoading(false);
    }
  }, [overviewState, range, filters, page, toast]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const categoryOptions = useMemo(() => {
    const fromData = overview?.metrics.by_type.map((t) => t.category) ?? [];
    return Array.from(new Set(fromData)).sort();
  }, [overview]);

  const pageCount = report ? Math.max(1, Math.ceil(report.total / PAGE_SIZE)) : 1;

  const exportCsv = async () => {
    if (!report) return;
    if (report.total > CSV_EXPORT_LIMIT) {
      toast({
        title: "Too many rows to export",
        description: `This filter matches ${report.total.toLocaleString()} transactions. Narrow the filters — exports are limited to ${CSV_EXPORT_LIMIT.toLocaleString()} rows.`,
        variant: "destructive",
      });
      return;
    }
    setExporting(true);
    try {
      const rows = [];
      for (let offset = 0; offset < report.total; offset += 1000) {
        const chunk = await fetchTreasuryReport(range, filters, 1000, offset);
        rows.push(...chunk.rows);
        if (chunk.rows.length === 0) break;
      }
      const blob = new Blob([buildTreasuryCsv(rows)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `treasury-report-${range.from.toISOString().slice(0, 10)}-to-${range.to
        .toISOString()
        .slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "Export ready",
        description: `${rows.length.toLocaleString()} transactions downloaded as CSV.`,
      });
    } catch (error) {
      console.error("Treasury CSV export failed:", error);
      toast({
        title: "Export failed",
        description: "We couldn't prepare the CSV export. Please try again.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  // ---- Shell states ---------------------------------------------------
  if (overviewState === "loading") {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
          <div role="status" aria-label="Loading treasury">
            <Skeleton className="h-9 w-64 mb-2" />
            <Skeleton className="h-5 w-96 max-w-full mb-6" />
            <SkeletonStatCardsRow className="mb-6" />
            <div className="rounded-xl border border-border bg-card p-6">
              <Skeleton className="h-5 w-40 mb-4" />
              <Skeleton className="h-[220px] w-full rounded-lg" />
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (overviewState === "refused") {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
          <Card className="max-w-xl mx-auto mt-10">
            <CardContent className="py-10 text-center space-y-3">
              <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground" />
              <h1 className="text-xl font-semibold">Super admin only</h1>
              <p className="text-muted-foreground">
                The Treasury &amp; Reports console shows the platform&apos;s own
                balances and fee income, so it is limited to the platform super
                admin. Your account does not have that role.
              </p>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  if (overviewState === "error" || !overview) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
          <Card className="max-w-xl mx-auto mt-10">
            <CardContent className="py-10 text-center space-y-4">
              <Landmark className="h-10 w-10 mx-auto text-muted-foreground" />
              <h1 className="text-xl font-semibold">We couldn&apos;t load the treasury</h1>
              <p className="text-muted-foreground">
                Something went wrong while loading the platform figures. Your
                money is not affected — please try again.
              </p>
              <Button onClick={() => setRefreshTick((t) => t + 1)}>
                <RefreshCw className="h-4 w-4 mr-2" /> Try again
              </Button>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    );
  }

  const { balances, fees, metrics } = overview;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Treasury &amp; Reports</h1>
            <p className="text-muted-foreground">
              The platform&apos;s own money — balances, fee income and reports,
              straight from the ledger.
            </p>
          </div>
          <Button variant="outline" onClick={() => setRefreshTick((t) => t + 1)}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        {/* Period switcher */}
        <div className="flex flex-col gap-3 mb-8">
          <div className="flex flex-wrap gap-2">
            {TREASURY_PRESETS.map((p) => (
              <Button
                key={p.value}
                variant={preset === p.value ? "default" : "outline"}
                size="sm"
                onClick={() => setPreset(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-auto"
                aria-label="From date"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-auto"
                aria-label="To date"
              />
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Showing {range.from.toLocaleString()} — {range.to.toLocaleString()}.
            Balances are current and do not change with the period.
          </p>
        </div>

        {/* Balances */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Platform balances</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Money that belongs to the platform itself — the operator wallets
            every fee is paid into, plus the Bitcoin treasury float.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {balances.platform_fiat.map((b) => (
              <Card key={`platform-${b.currency}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Platform wallet · {b.currency}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-[26px] font-display font-semibold tabular-nums">
                    {formatMoney(b.balance, b.currency)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Across {b.wallets} wallet{b.wallets === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            ))}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Platform Bitcoin wallet</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-[26px] font-display font-semibold tabular-nums">
                  {formatSatsAmount(balances.platform_btc_sats)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Custodial BTC held in the operator&apos;s own wallet
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Bitcoin treasury float</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-[26px] font-display font-semibold tabular-nums">
                  {formatSatsAmount(balances.btc_treasury_float_sats)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Platform inventory backing instant buy / sell
                </p>
              </CardContent>
            </Card>
          </div>

          <h3 className="text-lg font-semibold mt-8 mb-1">Customer funds held</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Balances belonging to users — the platform holds these, it does not
            own them. Always shown separately from platform money.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {balances.user_fiat.map((b) => (
              <Card key={`user-${b.currency}`} className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    User wallets · {b.currency}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-[26px] font-display font-semibold tabular-nums">
                    {formatMoney(b.balance, b.currency)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Across {b.wallets} wallet{b.wallets === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            ))}
            <Card className="border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">User Bitcoin</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-[26px] font-display font-semibold tabular-nums">
                  {formatSatsAmount(balances.user_btc_sats)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Custodial BTC belonging to users
                </p>
              </CardContent>
            </Card>
            {bankLiabilities && (
              <Card className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Bank payouts owed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-[26px] font-display font-semibold tabular-nums">
                    {formatMoney(bankLiabilities.total_outstanding_zmw, "ZMW")}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Reserved for bank withdrawals:{" "}
                    {bankLiabilities.pending_review_count} in review (
                    {formatMoney(bankLiabilities.pending_review_zmw, "ZMW")}),{" "}
                    {bankLiabilities.approved_count} approved to pay (
                    {formatMoney(bankLiabilities.approved_zmw, "ZMW")})
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </section>

        {/* Fee income */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Fee income</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Fees collected in the selected period, by rail. Payment-link, send
            and transfer fees are receipts in the platform wallet; card funding,
            Bitcoin trade and P2P fees are measured from the records those
            rails keep.
          </p>
          {fees.by_rail.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No fees were collected in this period.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <div className="divide-y">
                  {fees.by_rail.map((f) => (
                    <div
                      key={`${f.rail}-${f.currency}`}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{feeRailLabel(f.rail)}</div>
                        <div className="text-xs text-muted-foreground">
                          {f.count} fee{f.count === 1 ? "" : "s"} · {f.currency}
                        </div>
                      </div>
                      <div className="shrink-0 font-semibold tabular-nums">
                        {formatFeeAmount(f)}
                      </div>
                    </div>
                  ))}
                </div>
                {fees.totals.length > 0 && (
                  <div className="border-t mt-2 pt-4 space-y-1">
                    {fees.totals.map((t) => (
                      <div
                        key={`fee-total-${t.currency}`}
                        className="flex items-center justify-between"
                      >
                        <span className="font-semibold">Total · {t.currency}</span>
                        <span className="font-semibold tabular-nums">
                          {formatFeeAmount(t)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>

        {/* Metrics */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Activity in period</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-[26px] font-display font-semibold tabular-nums">
                  {metrics.tx_count.toLocaleString()}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">New users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-[26px] font-display font-semibold tabular-nums">
                  {metrics.new_users.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {metrics.users_total.toLocaleString()} total
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Active wallets</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-[26px] font-display font-semibold tabular-nums">
                  {metrics.wallets_active.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {metrics.wallets_total.toLocaleString()} wallets in total
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Wallets transacting</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-[26px] font-display font-semibold tabular-nums">
                  {metrics.wallets_transacting.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">In this period</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Completed volume by currency</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {metrics.volume.map((v) => (
                    <div key={`vol-${v.currency}`} className="flex items-center justify-between py-2.5">
                      <span>{v.currency}</span>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(v.completed_volume, v.currency)}
                      </span>
                    </div>
                  ))}
                  {metrics.volume.length === 0 && (
                    <p className="py-4 text-muted-foreground">No transactions in this period.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {metrics.by_status.map((s) => (
                    <Badge key={`${s.status}-${s.currency}`} variant="outline">
                      {s.status}: {s.count} · {s.currency}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Volume by type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y max-h-80 overflow-y-auto pr-1">
                  {metrics.by_type.map((t) => (
                    <div
                      key={`type-${t.category}-${t.currency}`}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{categoryLabel(t.category)}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.count} transaction{t.count === 1 ? "" : "s"} · {t.currency}
                        </div>
                      </div>
                      <div className="shrink-0 tabular-nums">
                        {formatMoney(t.completed_volume, t.currency)}
                      </div>
                    </div>
                  ))}
                  {metrics.by_type.length === 0 && (
                    <p className="py-4 text-muted-foreground">No transactions in this period.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Report */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-semibold">Transaction report</h2>
              <p className="text-sm text-muted-foreground">
                Every transaction in the selected period, filterable and
                exportable. Totals sum the completed transactions in the
                filtered set.
              </p>
            </div>
            <Button onClick={exportCsv} disabled={exporting || !report || report.total === 0}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? "Preparing…" : "Export CSV"}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search user, recipient, reference or description…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Currency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All currencies</SelectItem>
                      {CURRENCY_OPTIONS.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {categoryOptions.map((c) => (
                        <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={direction} onValueChange={setDirection}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Direction" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Both directions</SelectItem>
                      <SelectItem value="incoming">Incoming</SelectItem>
                      <SelectItem value="outgoing">Outgoing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {reportLoading && !report ? (
                <div className="py-4">
                  <SkeletonTableRows rows={4} />
                </div>
              ) : !report || report.rows.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  No transactions match these filters.
                </p>
              ) : (
                <>
                  {/* Phone: stacked rows */}
                  <div className="divide-y md:hidden">
                    {report.rows.map((r) => (
                      <div key={r.id} className="py-3 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate font-medium">
                            {r.recipient_name || r.user_name || categoryLabel(r.category)}
                          </span>
                          <span
                            className={`shrink-0 font-semibold tabular-nums ${
                              r.direction === "outgoing" ? "text-destructive" : "text-primary"
                            }`}
                          >
                            {r.direction === "outgoing" ? "−" : "+"}
                            {formatMoney(r.amount, r.currency)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span className="truncate">
                            {categoryLabel(r.category)} · {r.user_email || "—"}
                          </span>
                          <Badge variant="outline">{r.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString()}
                          {r.reference ? ` · ${r.reference}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tablet and up: full table */}
                  <div className="hidden md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Recipient</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="hidden lg:table-cell">Reference</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.rows.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                              {new Date(r.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell className="max-w-[160px] truncate" title={r.user_email || undefined}>
                              {r.user_name || r.user_email || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{categoryLabel(r.category)}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[160px] truncate">
                              {r.recipient_name || "—"}
                            </TableCell>
                            <TableCell
                              className={`text-right tabular-nums ${
                                r.direction === "outgoing" ? "text-destructive" : "text-primary"
                              }`}
                            >
                              {r.direction === "outgoing" ? "−" : "+"}
                              {formatMoney(r.amount, r.currency)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{r.status}</Badge>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell max-w-[140px] truncate text-muted-foreground text-sm">
                              {r.reference || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Filtered totals */}
                  {report.totals.length > 0 && (
                    <div className="border-t mt-4 pt-4 space-y-1.5">
                      {report.totals.map((t) => (
                        <div
                          key={`report-total-${t.currency}`}
                          className="flex flex-wrap items-center justify-between gap-2 text-sm"
                        >
                          <span className="font-semibold">
                            Filtered total · {t.currency} ({t.count} transactions)
                          </span>
                          <span className="tabular-nums">
                            In {formatMoney(t.incoming, t.currency)} · Out{" "}
                            {formatMoney(t.outgoing, t.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm text-muted-foreground">
                      {report.total.toLocaleString()} transactions · Page {page + 1} of {pageCount}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page === 0 || reportLoading}
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" /> Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page + 1 >= pageCount || reportLoading}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        Next <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default AdminTreasury;
