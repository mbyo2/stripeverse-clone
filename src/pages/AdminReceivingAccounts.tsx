import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  adminAssignAccount,
  adminCreatePartner,
  adminCreditDeposit,
  adminRecordDeposit,
  adminRejectDeposit,
  adminSetAccountStatus,
  adminUpdatePartner,
  fetchAllPartners,
  fetchAllReceivingAccounts,
  fetchRecordedDeposits,
} from "@/services/receivingAccountsService";
import {
  RECEIVING_CURRENCIES,
  type ReceivingAccount,
  type ReceivingDeposit,
  type ReceivingPartner,
} from "@/utils/receivingAccounts";
import { Landmark } from "lucide-react";

const PARTNER_STATUSES = ["prospect", "onboarding", "live"] as const;

const AdminReceivingAccounts = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [partners, setPartners] = useState<ReceivingPartner[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [recorded, setRecorded] = useState<ReceivingDeposit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // Partner create form
  const [partnerForm, setPartnerForm] = useState({
    name: "",
    currencies: [] as string[],
    status: "prospect",
    notes: "",
  });

  // Assignment form (one account at a time)
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState({
    partnerId: "",
    holderName: "",
    routingNumber: "",
    accountNumber: "",
    iban: "",
    bic: "",
    sortCode: "",
  });

  // Deposit record form
  const [depositForm, setDepositForm] = useState({
    accountId: "",
    amount: "",
    senderName: "",
    senderReference: "",
  });

  const load = useCallback(async () => {
    const [allPartners, allAccounts, recordedDeposits] = await Promise.all([
      fetchAllPartners(),
      fetchAllReceivingAccounts(),
      fetchRecordedDeposits(),
    ]);
    setPartners(allPartners);
    setAccounts(allAccounts);
    setRecorded(recordedDeposits);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const report = (result: { ok: boolean; message: string }) => {
    toast({
      title: result.ok ? "Done" : "Couldn't do that",
      description: result.message,
      variant: result.ok ? "default" : "destructive",
    });
    if (result.ok) load();
  };

  const run = async (key: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(key);
    const result = await fn();
    setBusy(null);
    report(result);
  };

  const livePartners = partners.filter((p) => p.status === "live");
  const assignableAccounts = accounts.filter((a) =>
    ["assigned", "active"].includes(a.status),
  );
  const assigningAccount = accounts.find((a) => a.id === assigningId);

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1100px] mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold flex items-center gap-2">
            <Landmark className="h-7 w-7" /> Receiving Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-[720px]">
            Banking partners, assignment of partner-issued account details,
            and inbound payment crediting. Details can only be recorded from
            a partner marked live — the platform never generates account
            numbers itself.
          </p>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── Partners ─────────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Banking partners</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {partners.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No partners recorded yet.
                  </p>
                )}
                {partners.map((partner) => (
                  <div
                    key={partner.id}
                    className="flex flex-wrap items-center gap-2 border rounded-md px-3 py-2"
                  >
                    <span className="font-medium text-sm">{partner.name}</span>
                    <Badge variant="secondary" className="capitalize">
                      {partner.status}
                    </Badge>
                    {partner.currencies.map((c) => (
                      <Badge key={c} variant="outline">
                        {c}
                      </Badge>
                    ))}
                    <span className="flex-1" />
                    <Select
                      value={partner.status}
                      onValueChange={(status) =>
                        run(`partner-${partner.id}`, () =>
                          adminUpdatePartner({ partnerId: partner.id, status }),
                        )
                      }
                    >
                      <SelectTrigger className="w-[150px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PARTNER_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}

                <div className="border-t pt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="partner-name">Partner name</Label>
                    <Input
                      id="partner-name"
                      value={partnerForm.name}
                      onChange={(e) =>
                        setPartnerForm({ ...partnerForm, name: e.target.value })
                      }
                      placeholder="Exactly as contracted"
                    />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select
                      value={partnerForm.status}
                      onValueChange={(status) =>
                        setPartnerForm({ ...partnerForm, status })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PARTNER_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Currencies</Label>
                    <div className="flex gap-2 pt-2">
                      {RECEIVING_CURRENCIES.map((c) => (
                        <Button
                          key={c}
                          type="button"
                          size="sm"
                          variant={
                            partnerForm.currencies.includes(c)
                              ? "default"
                              : "outline"
                          }
                          onClick={() =>
                            setPartnerForm({
                              ...partnerForm,
                              currencies: partnerForm.currencies.includes(c)
                                ? partnerForm.currencies.filter((x) => x !== c)
                                : [...partnerForm.currencies, c],
                            })
                          }
                        >
                          {c}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="partner-notes">Notes</Label>
                    <Input
                      id="partner-notes"
                      value={partnerForm.notes}
                      onChange={(e) =>
                        setPartnerForm({ ...partnerForm, notes: e.target.value })
                      }
                      placeholder="Agreement reference, contacts…"
                    />
                  </div>
                  <div>
                    <Button
                      disabled={busy === "partner-create" || !partnerForm.name}
                      onClick={() =>
                        run("partner-create", () =>
                          adminCreatePartner({
                            name: partnerForm.name,
                            currencies: partnerForm.currencies,
                            status: partnerForm.status,
                            notes: partnerForm.notes || undefined,
                          }),
                        )
                      }
                    >
                      Add partner
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Accounts ─────────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Accounts &amp; requests
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {accounts.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No receiving accounts or requests yet.
                  </p>
                )}
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="border rounded-md px-3 py-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">
                        {account.currency} receiving account
                      </span>
                      <Badge variant="secondary" className="capitalize">
                        {account.status.replace("_", " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        user {account.user_id.slice(0, 8)}… · requested{" "}
                        {new Date(account.created_at).toLocaleDateString()}
                      </span>
                      <span className="flex-1" />
                      {account.status === "requested" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === account.id}
                          onClick={() =>
                            run(account.id, () =>
                              adminSetAccountStatus(
                                account.id,
                                "pending_partner",
                              ),
                            )
                          }
                        >
                          Mark pending with partner
                        </Button>
                      )}
                      {["requested", "pending_partner"].includes(
                        account.status,
                      ) && (
                        <Button
                          size="sm"
                          disabled={busy === account.id}
                          onClick={() => {
                            setAssigningId(
                              assigningId === account.id ? null : account.id,
                            );
                            setAssignForm({
                              partnerId: "",
                              holderName: "",
                              routingNumber: "",
                              accountNumber: "",
                              iban: "",
                              bic: "",
                              sortCode: "",
                            });
                          }}
                        >
                          Assign issued details
                        </Button>
                      )}
                      {account.status === "assigned" && (
                        <Button
                          size="sm"
                          disabled={busy === account.id}
                          onClick={() =>
                            run(account.id, () =>
                              adminSetAccountStatus(account.id, "active"),
                            )
                          }
                        >
                          Activate
                        </Button>
                      )}
                      {account.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === account.id}
                          onClick={() =>
                            run(account.id, () =>
                              adminSetAccountStatus(account.id, "suspended"),
                            )
                          }
                        >
                          Suspend
                        </Button>
                      )}
                      {account.status === "suspended" && (
                        <Button
                          size="sm"
                          disabled={busy === account.id}
                          onClick={() =>
                            run(account.id, () =>
                              adminSetAccountStatus(account.id, "active"),
                            )
                          }
                        >
                          Reinstate
                        </Button>
                      )}
                      {account.status !== "closed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === account.id}
                          onClick={() =>
                            run(account.id, () =>
                              adminSetAccountStatus(account.id, "closed"),
                            )
                          }
                        >
                          Close
                        </Button>
                      )}
                    </div>

                    {assigningId === account.id && (
                      <div className="grid gap-3 sm:grid-cols-2 border-t pt-3">
                        <div>
                          <Label>Issuing partner (live only)</Label>
                          <Select
                            value={assignForm.partnerId}
                            onValueChange={(partnerId) =>
                              setAssignForm({ ...assignForm, partnerId })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select partner" />
                            </SelectTrigger>
                            <SelectContent>
                              {livePartners
                                .filter((p) =>
                                  p.currencies.includes(account.currency),
                                )
                                .map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          {livePartners.length === 0 && (
                            <p className="text-xs text-muted-foreground pt-1">
                              No live partner yet — details cannot be
                              assigned until a partner is marked live.
                            </p>
                          )}
                        </div>
                        <div>
                          <Label htmlFor="holder">Account holder name</Label>
                          <Input
                            id="holder"
                            value={assignForm.holderName}
                            onChange={(e) =>
                              setAssignForm({
                                ...assignForm,
                                holderName: e.target.value,
                              })
                            }
                            placeholder="Exactly as issued"
                          />
                        </div>
                        {account.currency === "USD" && (
                          <>
                            <div>
                              <Label htmlFor="routing">Routing number</Label>
                              <Input
                                id="routing"
                                value={assignForm.routingNumber}
                                onChange={(e) =>
                                  setAssignForm({
                                    ...assignForm,
                                    routingNumber: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor="acct">Account number</Label>
                              <Input
                                id="acct"
                                value={assignForm.accountNumber}
                                onChange={(e) =>
                                  setAssignForm({
                                    ...assignForm,
                                    accountNumber: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </>
                        )}
                        {account.currency === "EUR" && (
                          <>
                            <div>
                              <Label htmlFor="iban">IBAN</Label>
                              <Input
                                id="iban"
                                value={assignForm.iban}
                                onChange={(e) =>
                                  setAssignForm({
                                    ...assignForm,
                                    iban: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor="bic">BIC / SWIFT (optional)</Label>
                              <Input
                                id="bic"
                                value={assignForm.bic}
                                onChange={(e) =>
                                  setAssignForm({
                                    ...assignForm,
                                    bic: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </>
                        )}
                        {account.currency === "GBP" && (
                          <>
                            <div>
                              <Label htmlFor="sort">Sort code</Label>
                              <Input
                                id="sort"
                                value={assignForm.sortCode}
                                onChange={(e) =>
                                  setAssignForm({
                                    ...assignForm,
                                    sortCode: e.target.value,
                                  })
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor="acct-gbp">Account number</Label>
                              <Input
                                id="acct-gbp"
                                value={assignForm.accountNumber}
                                onChange={(e) =>
                                  setAssignForm({
                                    ...assignForm,
                                    accountNumber: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </>
                        )}
                        <div className="sm:col-span-2">
                          <Button
                            disabled={
                              busy === `assign-${account.id}` ||
                              !assignForm.partnerId ||
                              !assignForm.holderName
                            }
                            onClick={() =>
                              run(`assign-${account.id}`, async () => {
                                const result = await adminAssignAccount({
                                  accountId: account.id,
                                  partnerId: assignForm.partnerId,
                                  accountHolderName: assignForm.holderName,
                                  routingNumber:
                                    assignForm.routingNumber || undefined,
                                  accountNumber:
                                    assignForm.accountNumber || undefined,
                                  iban: assignForm.iban || undefined,
                                  bic: assignForm.bic || undefined,
                                  sortCode: assignForm.sortCode || undefined,
                                });
                                if (result.ok) setAssigningId(null);
                                return result;
                              })
                            }
                          >
                            Save issued details
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* ── Record a deposit ─────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Record an arrived payment
                </CardTitle>
              </CardHeader>
              <CardContent>
                {assignableAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No account with issued details yet — payments can only be
                    recorded against assigned or active accounts.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Receiving account</Label>
                      <Select
                        value={depositForm.accountId}
                        onValueChange={(accountId) =>
                          setDepositForm({ ...depositForm, accountId })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          {assignableAccounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.currency} · user {a.user_id.slice(0, 8)}… ·{" "}
                              {a.status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="dep-amount">Amount received</Label>
                      <Input
                        id="dep-amount"
                        type="number"
                        min="0"
                        step="0.01"
                        value={depositForm.amount}
                        onChange={(e) =>
                          setDepositForm({
                            ...depositForm,
                            amount: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="dep-sender">Sender name</Label>
                      <Input
                        id="dep-sender"
                        value={depositForm.senderName}
                        onChange={(e) =>
                          setDepositForm({
                            ...depositForm,
                            senderName: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="dep-ref">Sender reference</Label>
                      <Input
                        id="dep-ref"
                        value={depositForm.senderReference}
                        onChange={(e) =>
                          setDepositForm({
                            ...depositForm,
                            senderReference: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <Button
                        disabled={
                          busy === "deposit-record" ||
                          !depositForm.accountId ||
                          !(Number(depositForm.amount) > 0)
                        }
                        onClick={() =>
                          run("deposit-record", () =>
                            adminRecordDeposit({
                              accountId: depositForm.accountId,
                              amount: Number(depositForm.amount),
                              senderName: depositForm.senderName || undefined,
                              senderReference:
                                depositForm.senderReference || undefined,
                            }),
                          )
                        }
                      >
                        Record payment
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Recorded deposits awaiting credit ────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Recorded payments awaiting credit
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recorded.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nothing waiting. Credited payments appear in the user's
                    wallet and incoming-payments list.
                  </p>
                )}
                {recorded.map((deposit) => (
                  <div
                    key={deposit.id}
                    className="flex flex-wrap items-center gap-2 border rounded-md px-3 py-2"
                  >
                    <span className="font-medium text-sm">
                      {deposit.currency} {Number(deposit.amount).toFixed(2)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {deposit.sender_name && `from ${deposit.sender_name} · `}
                      user {deposit.user_id.slice(0, 8)}… ·{" "}
                      {new Date(deposit.created_at).toLocaleDateString()}
                    </span>
                    <span className="flex-1" />
                    <Button
                      size="sm"
                      disabled={busy === deposit.id}
                      onClick={() =>
                        run(deposit.id, () => adminCreditDeposit(deposit.id))
                      }
                    >
                      Credit to wallet
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === deposit.id}
                      onClick={() =>
                        run(deposit.id, () => adminRejectDeposit(deposit.id))
                      }
                    >
                      Reject
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AdminReceivingAccounts;
