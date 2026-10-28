import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { fetchMyKycState, type KycState } from "@/services/p2pService";
import {
  fetchLivePartners,
  fetchMyReceivingAccounts,
  fetchMyReceivingDeposits,
  fetchReceivingAccountsEnabled,
  requestReceivingAccount,
} from "@/services/receivingAccountsService";
import {
  RECEIVING_CURRENCIES,
  RECEIVING_FEATURE_OFF_COPY,
  RECEIVING_INTRO_COPY,
  hasDisplayableDetails,
  receivingAccountStatusCopy,
  receivingDetailFields,
  receivingDepositStatusCopy,
  requestOutcomeMessage,
  type ReceivingAccount,
  type ReceivingDeposit,
  type ReceivingPartner,
} from "@/utils/receivingAccounts";
import { Check, Copy, Globe2, Landmark, ShieldCheck } from "lucide-react";

const CURRENCY_LABELS: Record<string, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
};

const ReceivingAccounts = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [deposits, setDeposits] = useState<ReceivingDeposit[]>([]);
  const [partners, setPartners] = useState<ReceivingPartner[]>([]);
  const [kyc, setKyc] = useState<KycState | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [flag, myAccounts, myDeposits, livePartners, kycState] =
      await Promise.all([
        fetchReceivingAccountsEnabled(),
        fetchMyReceivingAccounts(user.id),
        fetchMyReceivingDeposits(user.id),
        fetchLivePartners(),
        fetchMyKycState(user.id),
      ]);
    setEnabled(flag);
    setAccounts(myAccounts);
    setDeposits(myDeposits);
    setPartners(livePartners);
    setKyc(kycState);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const accountFor = (currency: string) =>
    accounts.find((a) => a.currency === currency);

  const partnerNameFor = (account: ReceivingAccount) =>
    partners.find((p) => p.id === account.partner_id)?.name ?? null;

  const handleRequest = async (currency: string) => {
    setRequesting(currency);
    const result = await requestReceivingAccount(currency);
    setRequesting(null);
    toast({
      title:
        result.outcome === "requested" || result.outcome === "already_exists"
          ? "Receiving account"
          : "Not yet",
      description: requestOutcomeMessage(result.outcome),
      variant:
        result.outcome === "kyc_required" ||
        result.outcome === "feature_not_enabled"
          ? "destructive"
          : "default",
    });
    if (result.outcome === "requested") load();
  };

  const copyValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label}:${value}`);
      toast({ title: "Copied", description: `${label} copied to clipboard.` });
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Please copy the value manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[900px] mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold flex items-center gap-2">
            <Landmark className="h-7 w-7" /> Receiving accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-[640px]">
            {RECEIVING_INTRO_COPY}
          </p>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !enabled && accounts.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Globe2 className="h-5 w-5" /> Being set up
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {RECEIVING_FEATURE_OFF_COPY}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {RECEIVING_CURRENCIES.map((currency) => {
              const account = accountFor(currency);
              const fields = account ? receivingDetailFields(account) : [];
              const showDetails = account
                ? hasDisplayableDetails(account)
                : false;
              return (
                <Card key={currency}>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between text-lg">
                      <span>
                        {currency}{" "}
                        <span className="text-sm font-normal text-muted-foreground">
                          {CURRENCY_LABELS[currency]} account
                        </span>
                      </span>
                      {account && (
                        <Badge variant="secondary" className="capitalize">
                          {account.status.replace("_", " ")}
                        </Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {!account && (
                      <>
                        <p className="text-sm text-muted-foreground">
                          No {currency} receiving account yet.
                        </p>
                        {kyc && kyc.status !== "verified" ? (
                          <div className="rounded-md border p-3 text-sm space-y-2">
                            <p className="flex items-start gap-2">
                              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                              Receiving accounts are issued in your legal
                              name, so identity verification comes first.
                            </p>
                            <Button asChild size="sm" variant="outline">
                              <Link to="/kyc">Verify your identity</Link>
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            disabled={requesting === currency}
                            onClick={() => handleRequest(currency)}
                          >
                            {requesting === currency
                              ? "Requesting…"
                              : `Request a ${currency} account`}
                          </Button>
                        )}
                      </>
                    )}

                    {account && !showDetails && (
                      <p className="text-sm text-muted-foreground">
                        {receivingAccountStatusCopy(account.status)}
                      </p>
                    )}

                    {account && showDetails && (
                      <>
                        <p className="text-sm text-muted-foreground">
                          {receivingAccountStatusCopy(account.status)}
                          {partnerNameFor(account) &&
                            ` Provided by ${partnerNameFor(account)}.`}
                        </p>
                        <div className="rounded-md border divide-y">
                          {fields.map((field) => (
                            <div
                              key={field.label}
                              className="flex items-center justify-between gap-3 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">
                                  {field.label}
                                </p>
                                <p className="text-sm font-mono break-all">
                                  {field.value}
                                </p>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Copy ${field.label}`}
                                onClick={() =>
                                  copyValue(field.label, field.value)
                                }
                              >
                                {copied === `${field.label}:${field.value}` ? (
                                  <Check className="h-4 w-4" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Incoming payments</CardTitle>
              </CardHeader>
              <CardContent>
                {deposits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No payments received to your receiving accounts yet.
                  </p>
                ) : (
                  <div className="divide-y">
                    {deposits.map((deposit) => (
                      <div
                        key={deposit.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {deposit.currency}{" "}
                            {Number(deposit.amount).toFixed(2)}
                            {deposit.sender_name &&
                              ` — from ${deposit.sender_name}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(deposit.created_at).toLocaleDateString()}{" "}
                            · {receivingDepositStatusCopy(deposit.status)}
                          </p>
                        </div>
                        <Badge variant="outline" className="capitalize shrink-0">
                          {deposit.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default ReceivingAccounts;
