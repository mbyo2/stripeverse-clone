// Actor-name resolution for the Audit Logs page.
//
// The audit_logs table has NO foreign key to profiles (its generated
// Relationships list is empty), so PostgREST cannot embed the actor's
// name into the audit query: the old `profiles:user_id(...)` embed
// failed every single load with a schema-cache relationship error and
// the page sat on its error state for everyone, admins included.
//
// Names are therefore resolved in a second step: the page fetches the
// profiles for just the actor ids present in the loaded page of logs
// and merges them on here. The merge is pure so it can be unit-tested
// without a database.

export interface AuditProfileName {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

export interface AuditLogRow {
  user_id: string | null;
  [key: string]: unknown;
}

/** Distinct non-null actor ids across a page of audit logs. */
export function auditActorIds(logs: Pick<AuditLogRow, "user_id">[]): string[] {
  return [
    ...new Set(
      logs
        .map((log) => log.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
}

/**
 * Attach each log's actor profile (or null when the actor is unknown
 * or the log has no actor) under the `profiles` key the Audit Logs
 * page already renders from.
 */
export function attachProfileNames<T extends Pick<AuditLogRow, "user_id">>(
  logs: T[],
  profiles: AuditProfileName[]
): (T & { profiles: AuditProfileName | null })[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  return logs.map((log) => ({
    ...log,
    profiles: log.user_id ? byId.get(log.user_id) ?? null : null,
  }));
}
