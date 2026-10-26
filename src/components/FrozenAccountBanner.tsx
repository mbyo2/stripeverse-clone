import { Snowflake } from "lucide-react";
import {
  FROZEN_BANNER_MESSAGE,
  FROZEN_BANNER_TITLE,
} from "@/utils/frozenBanner";

/**
 * Shown on the signed-in user's own dashboard when their profile is
 * frozen (profiles.is_frozen). Before this, a frozen user's
 * dashboard looked completely normal until a send attempt was
 * refused. Keyed to the viewer's own profile only — admins viewing
 * another user's record use AdminUserDetail, which has its own
 * frozen notice.
 */
const FrozenAccountBanner = () => (
  <div
    role="alert"
    className="mb-6 flex items-start gap-3 rounded-[16px] border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
  >
    <Snowflake className="h-5 w-5 mt-0.5 shrink-0" />
    <div>
      <p className="font-semibold">{FROZEN_BANNER_TITLE}</p>
      <p className="text-sm mt-0.5">{FROZEN_BANNER_MESSAGE}</p>
    </div>
  </div>
);

export default FrozenAccountBanner;
