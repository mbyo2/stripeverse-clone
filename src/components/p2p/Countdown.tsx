import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { countdownTo } from "@/utils/p2pUi";
import { cn } from "@/lib/utils";

/** Live-ticking countdown to an ISO timestamp (payment windows,
 *  seller deadlines, negotiation windows). Ticks once a second and
 *  turns destructive under five minutes — timers are a safety
 *  surface in P2P, so they are always visible, never decorative. */
export default function Countdown({
  to,
  label,
  className,
}: {
  to: string | null | undefined;
  label?: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const cd = countdownTo(to, now);
  if (!cd) return null;
  const urgent = !cd.expired && cd.totalMs < 5 * 60 * 1000;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-sm",
        cd.expired || urgent ? "text-destructive" : "text-foreground",
        className,
      )}
    >
      <Timer className="h-4 w-4" />
      {label && <span className="font-sans text-muted-foreground">{label}</span>}
      {cd.expired ? "Expired" : cd.label}
    </span>
  );
}
