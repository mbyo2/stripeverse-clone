import { Check, Circle, Lock, X } from "lucide-react";
import { orderSteps, type P2pOrderStatus } from "@/utils/p2pUi";
import { cn } from "@/lib/utils";

/** Locked → Pay → Confirm → Done stepper (§4.4). A disputed trade
 *  freezes the stepper at the step it had reached, shown blocked —
 *  the visual twin of the escrow freeze itself. */
export default function OrderStatusStepper({
  status,
  paidMarkedAt,
}: {
  status: string;
  paidMarkedAt?: string | null;
}) {
  const steps = orderSteps(status as P2pOrderStatus, { paidMarkedAt });
  return (
    <ol className="flex items-center w-full" aria-label="Trade progress">
      {steps.map((step, i) => (
        <li key={step.key} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border text-xs shrink-0",
                step.state === "done" &&
                  "bg-primary text-primary-foreground border-primary",
                step.state === "current" &&
                  "border-primary text-primary bg-primary/10",
                step.state === "blocked" &&
                  "border-destructive text-destructive bg-destructive/10",
                step.state === "upcoming" &&
                  "border-muted-foreground/40 text-muted-foreground",
              )}
            >
              {step.state === "done" ? (
                <Check className="h-4 w-4" />
              ) : step.state === "blocked" ? (
                <X className="h-4 w-4" />
              ) : step.state === "current" ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
            </span>
            <span
              className={cn(
                "text-xs sm:text-sm whitespace-nowrap",
                step.state === "upcoming" && "text-muted-foreground",
                step.state === "blocked" && "text-destructive font-medium",
                step.state === "current" && "font-medium",
                // On narrow phones the four labels + circles exceed the
                // card width and push the page sideways. Show only the
                // current/blocked step's label there; all labels return
                // once the row genuinely fits.
                (step.state === "done" || step.state === "upcoming") &&
                  "hidden min-[560px]:inline",
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "mx-2 h-px flex-1",
                step.state === "done" ? "bg-primary" : "bg-border",
              )}
            />
          )}
        </li>
      ))}
    </ol>
  );
}
