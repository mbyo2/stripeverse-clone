import { Card, CardContent } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

/**
 * Virtual cards are "Coming soon" for the public (CEO decision,
 * 2026-10-22): card creation and card actions stay switched off until
 * the Mastercard developer-platform integration is built AND tested.
 * Users with the admin role keep full access for sandbox testing —
 * the card pages render this panel for everyone else.
 *
 * Copy stays honest about what exists today: BMaGlass virtual cards
 * are internal wallet cards — not Mastercard, Visa, or bank cards.
 */
const VirtualCardsComingSoon = () => {
  return (
    <Card>
      <CardContent className="pt-10 pb-10 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <CreditCard className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-display font-semibold mb-2">
          Virtual Cards are coming soon
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          We're building virtual cards on the Mastercard developer
          platform. Until that integration is complete and fully tested,
          virtual cards aren't available — we'd rather switch them on
          finished than half-working.
        </p>
        <p className="text-sm text-muted-foreground mt-4">
          When they launch, you'll be able to create and manage your
          cards right here.
        </p>
      </CardContent>
    </Card>
  );
};

export default VirtualCardsComingSoon;
