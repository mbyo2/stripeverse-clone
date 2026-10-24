import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Paperclip, Send, ShieldAlert, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  p2pEvidenceSignedUrl,
  sendTradeMessage,
  uploadP2pEvidenceFile,
  type P2pMessage,
  type P2pOrder,
} from "@/services/p2pService";
import { p2pKeys, useP2pMessages } from "@/hooks/useP2p";
import { isTerminalP2pOrderStatus } from "@/utils/p2pUi";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const CHAT_POST_CLOSE_MS = 24 * 3600 * 1000;

/**
 * Trade chat (§3.7). Messages are read from the stored record —
 * what you see is the masked, evidence-grade version both parties
 * and (in a dispute) the admin sees; the original text is never
 * stored. Sending goes through the edge function, which scans and
 * masks contact details and returns the strike `warning` the
 * sender must see. Attachments carry a standing viewer warning:
 * images can hide QR codes and contact details (§3.7 QR scams).
 */
export default function TradeChat({ order }: { order: P2pOrder }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  // Chat stays live (and keeps polling) while the trade is open and
  // for 24h after it closes (parties may still need to talk); once
  // read-only it never polls again (scalability fix #5).
  const terminal = isTerminalP2pOrderStatus(order.status);
  const closedAt = new Date(
    order.completed_at ?? order.cancelled_at ?? order.updated_at,
  ).getTime();
  const readOnly = terminal && Date.now() - closedAt > CHAT_POST_CLOSE_MS;
  const messagesQuery = useP2pMessages(order.id, !readOnly);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<{ path: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = messagesQuery.data ?? [];
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = useMutation({
    mutationFn: () =>
      sendTradeMessage(order.id, draft.trim(), attachment?.path ?? null),
    onSuccess: (res) => {
      setDraft("");
      setAttachment(null);
      void qc.invalidateQueries({ queryKey: p2pKeys.messages(order.id) });
      if (res.warning) {
        toast({
          title: "Message sent — with a warning",
          description: res.warning,
          variant: "destructive",
        });
      }
    },
    onError: (e: unknown) => {
      toast({
        title: "Message not sent",
        description:
          e instanceof Error ? e.message : "Your message could not be sent. Please try again.",
        variant: "destructive",
      });
    },
  });

  const attach = async (file: File) => {
    setUploading(true);
    try {
      const { path } = await uploadP2pEvidenceFile(file, `chat/${order.id}`);
      setAttachment({ path, name: file.name });
    } catch (e) {
      toast({
        title: "Attachment failed",
        description:
          e instanceof Error ? e.message : "The file could not be uploaded.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const viewAttachment = async (path: string) => {
    const url = await p2pEvidenceSignedUrl(path);
    if (url) {
      window.open(url, "_blank", "noopener");
    } else {
      toast({
        title: "Attachment unavailable",
        description: "That file can't be opened right now. It is still recorded on this trade.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trade chat</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-xs leading-relaxed">
            Stay safe: only pay the account shown on this order. BMaGlass staff
            will never message you inside a trade, never ask you to cancel or
            release, and never ask you to move to WhatsApp. Never scan or pay a
            QR code sent in chat. Sharing contact details is against P2P rules
            and is hidden automatically.
          </AlertDescription>
        </Alert>

        <div
          ref={scrollRef}
          className="h-80 overflow-y-auto space-y-2 pr-1"
          aria-live="polite"
        >
          {messagesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading messages…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet. Say hello — and keep everything about this trade
              in this chat.
            </p>
          ) : (
            messages.map((m: P2pMessage) => {
              if (m.sender_type === "system") {
                return (
                  <div key={m.id} className="flex justify-center">
                    <p className="text-[11px] text-muted-foreground bg-muted rounded-full px-3 py-1 max-w-[90%] text-center">
                      {m.body}
                    </p>
                  </div>
                );
              }
              const mine = m.sender_id === user?.id;
              const flags = Array.isArray(m.scan_flags) ? m.scan_flags : [];
              return (
                <div
                  key={m.id}
                  className={cn("flex", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-sm space-y-1",
                      m.sender_type === "support"
                        ? "bg-blue-500/10 border border-blue-500/30"
                        : mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted",
                    )}
                  >
                    {m.sender_type === "support" && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                        Support — dispute assistance
                      </p>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    {flags.length > 0 && (
                      <p
                        className={cn(
                          "text-[10px]",
                          mine ? "text-primary-foreground/80" : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        Contact details were hidden in this message.
                      </p>
                    )}
                    {m.attachment_path && (
                      <div className="pt-1 space-y-1">
                        <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          ⚠ Attachments can hide QR codes or contact details.
                          Never pay from an attachment — only the account on
                          this order.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => void viewAttachment(m.attachment_path!)}
                        >
                          <Paperclip className="h-3 w-3 mr-1" /> View attachment
                        </Button>
                      </div>
                    )}
                    <p
                      className={cn(
                        "text-[10px] text-right",
                        mine ? "text-primary-foreground/70" : "text-muted-foreground",
                      )}
                    >
                      {format(new Date(m.created_at), "HH:mm")}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {readOnly ? (
          <p className="text-xs text-muted-foreground border-t border-border pt-3">
            This trade is closed and its chat is now read-only. The full record
            is kept as evidence.
          </p>
        ) : (
          <div className="space-y-2 border-t border-border pt-3">
            {attachment && (
              <div className="flex items-center gap-2 text-xs bg-muted rounded-md px-2 py-1 w-fit">
                <Paperclip className="h-3 w-3" />
                <span className="truncate max-w-56">{attachment.name}</span>
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => setAttachment(null)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void attach(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={uploading || send.isPending}
                onClick={() => fileRef.current?.click()}
                aria-label="Attach a file"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message your trading partner…"
                maxLength={2000}
                rows={2}
                className="flex-1 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (draft.trim() || attachment) send.mutate();
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                disabled={send.isPending || uploading || (!draft.trim() && !attachment)}
                onClick={() => send.mutate()}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
