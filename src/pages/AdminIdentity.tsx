// /admin/identity — the face-verification review queue.
//
// Admin-only (route guard + the edge function's own double gate).
// A verification lands here when its automatic outcome needs a
// human: low-but-plausible match, a duplicate-face hit, an unscored
// match, or a manual photo submission. The reviewer sees the selfie
// beside the document photo, the match score, any duplicate hits
// and the movement-check summary, then approves or rejects with a
// note (a note is mandatory on rejection, enforced server-side too).

import { useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { format } from "date-fns";
import PageErrorState from "@/components/PageErrorState";
import { useToast } from "@/hooks/use-toast";
import { useIdentityReviewQueue, useInvalidateIdentity } from "@/hooks/useIdentity";
import {
  decideIdentityVerification,
  eraseIdentityData,
  IdentityActionError,
  type AdminReviewItem,
} from "@/services/identityService";
import {
  dedupeSummary,
  formatMatchScore,
  identityStatusMeta,
  summariseTranscript,
} from "@/utils/identityUi";

function PhotoPanel({ title, url }: { title: string; url: string | null }) {
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      {url ? (
        <img
          src={url}
          alt={title}
          className="w-full rounded-lg border bg-muted object-contain max-h-80"
        />
      ) : (
        <div className="rounded-lg border bg-muted text-muted-foreground text-sm p-6 text-center">
          Not provided / unavailable
        </div>
      )}
    </div>
  );
}

export default function AdminIdentity() {
  const { toast } = useToast();
  const invalidate = useInvalidateIdentity();
  const queueQuery = useIdentityReviewQueue();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const selected: AdminReviewItem | null = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const decide = async (decision: "approve" | "reject") => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await decideIdentityVerification(selected.id, decision, notes);
      toast({
        title:
          decision === "approve"
            ? "Verification approved"
            : "Verification rejected",
      });
      setSelectedId(null);
      setNotes("");
      invalidate();
    } catch (e) {
      setError(
        e instanceof IdentityActionError
          ? e.message
          : "The decision could not be saved. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const [eraseArmed, setEraseArmed] = useState(false);

  const erase = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await eraseIdentityData(selected.user_id);
      toast({
        title: "Biometric data erased",
        description: `${res.erased_files} file(s) and the face template for this account were permanently deleted.`,
      });
      setSelectedId(null);
      setNotes("");
      setEraseArmed(false);
      invalidate();
    } catch (e) {
      setError(
        e instanceof IdentityActionError
          ? e.message
          : "The erasure could not be completed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-secondary/20">
      <Header />
      <main className="pt-24 pb-16 px-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          {selected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedId(null);
                setNotes("");
                setError(null);
              }}
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Queue
            </Button>
          )}
          <div>
            <h1 className="text-3xl font-bold">Identity Review</h1>
            <p className="text-sm text-muted-foreground">
              Face verifications that need a human decision, oldest first.
            </p>
          </div>
        </div>

        {queueQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : queueQuery.isError ? (
          <PageErrorState
            title="We couldn't load the review queue"
            message="Check your connection and try again."
            onRetry={() => void queueQuery.refetch()}
          />
        ) : !selected ? (
          items.length === 0 ? (
            <Card>
              <CardContent className="pt-6 flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-primary" />
                <p className="text-sm text-muted-foreground">
                  The review queue is clear — nothing is waiting for a
                  decision.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {items.map((item) => {
                const meta = identityStatusMeta(item.status);
                return (
                  <Card key={item.id}>
                    <CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {item.user_email ?? item.user_id}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {(item.document_type ?? "Document").replace("_", " ")} · submitted{" "}
                          {format(new Date(item.created_at), "d MMM yyyy, HH:mm")} ·
                          match {formatMatchScore(item.match_score)}
                        </div>
                        {dedupeSummary(item.dedupe) && (
                          <div className="text-xs text-destructive mt-1">
                            {dedupeSummary(item.dedupe)}
                          </div>
                        )}
                      </div>
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                      <Button size="sm" onClick={() => setSelectedId(item.id)}>
                        Review
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )
        ) : (
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {selected.user_email ?? selected.user_id}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <PhotoPanel title="Selfie" url={selected.selfie_url} />
                  <PhotoPanel
                    title="Document — front"
                    url={selected.document_front_url}
                  />
                </div>
                {selected.document_back_url && (
                  <div className="max-w-md">
                    <PhotoPanel
                      title="Document — back"
                      url={selected.document_back_url}
                    />
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2 text-sm">
                  <div className="space-y-1">
                    <Label>Face match score</Label>
                    <p>{formatMatchScore(selected.match_score)}</p>
                    <p className="text-xs text-muted-foreground">
                      Decision support only — nothing is approved
                      automatically. 0.62 or higher reads as a strong
                      match; under 0.42 the faces are almost certainly
                      different people. In between, or for a manual
                      submission with no score, your judgement on the
                      photos decides.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label>Duplicate-face check</Label>
                    <p>{dedupeSummary(selected.dedupe) ?? "No duplicate face found."}</p>
                    {(Array.isArray(selected.dedupe?.hits) ? selected.dedupe.hits : []).map((h) => (
                      <p key={h.user_id} className="text-xs text-muted-foreground">
                        Account {h.user_id} — similarity {Number(h.score ?? 0).toFixed(2)}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label>Movement check</Label>
                    {summariseTranscript(selected.liveness).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label>Consent & timing</Label>
                    <p>
                      Consent given:{" "}
                      {selected.consent_given_at
                        ? format(new Date(selected.consent_given_at), "d MMM yyyy, HH:mm")
                        : "not recorded"}
                    </p>
                    <p>
                      Document: {(selected.document_type ?? "Document").replace("_", " ")}
                    </p>
                  </div>
                </div>

                <Alert>
                  <AlertTitle>Before you decide</AlertTitle>
                  <AlertDescription>
                    Compare the selfie with the document photo yourself —
                    the score supports your decision, it does not make
                    it. Approving enrols this face to this account (the
                    same face then cannot verify another account
                    silently). Reject when the faces differ, the
                    document looks altered, or a duplicate hit is the
                    same person on a second account.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="identity-notes">
                    Reviewer note (required to reject; the user sees it)
                  </Label>
                  <Textarea
                    id="identity-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What you checked and why you decided this way"
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void decide("approve")} disabled={busy}>
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Approve verification
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => void decide("reject")}
                    disabled={busy || notes.trim().length === 0}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject
                  </Button>
                </div>

                <div className="border-t pt-4 space-y-2">
                  <Label>Erase this account's biometric data</Label>
                  <p className="text-xs text-muted-foreground">
                    For a consent withdrawal or erasure request:
                    permanently deletes this account's document photos,
                    selfie, stored face templates and enrolment, and
                    marks their verifications erased. This cannot be
                    undone, is recorded in the audit log, and the
                    deletion runs for the whole account — not just this
                    submission.
                  </p>
                  {eraseArmed ? (
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        onClick={() => void erase()}
                        disabled={busy}
                      >
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirm permanent erasure
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setEraseArmed(false)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setEraseArmed(true)}
                      disabled={busy}
                    >
                      Erase biometric data…
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
