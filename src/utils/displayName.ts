// Display-name resolution for greetings and headers.
//
// The profiles row is the source of truth: it is what the Settings
// page reads and writes, so it is the only name a user can actually
// change. Auth user_metadata is written once at account creation —
// and not at all for dashboard-created accounts — so anything that
// greets from metadata alone shows a stale name, or no name at all,
// to users who saved their name in Settings (QA Wave 4: a user with
// First "QA" / Last "Three" saved was still greeted "Welcome back,
// there" on the dashboard).

export interface ProfileNameSource {
  first_name?: string | null;
}

export interface MetadataNameSource {
  user_metadata?: Record<string, unknown> | null;
}

/**
 * First name to greet with: profiles first, then auth metadata
 * (first_name, then the first word of full_name), then "there".
 */
export const resolveFirstName = (
  profile: ProfileNameSource | null | undefined,
  user: MetadataNameSource | null | undefined,
): string => {
  const fromProfile = profile?.first_name?.trim();
  if (fromProfile) return fromProfile;

  const meta = user?.user_metadata ?? {};
  const metaFirst = typeof meta.first_name === 'string' ? meta.first_name.trim() : '';
  if (metaFirst) return metaFirst;

  const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
  const fullNameFirst = fullName.split(/\s+/)[0];
  if (fullNameFirst) return fullNameFirst;

  return 'there';
};
