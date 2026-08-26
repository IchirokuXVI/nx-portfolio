/**
 * Platform totals (plan 0017, section 8). Two services answer, each over its own
 * database: auth reports identity totals, core reports zone totals. There is no
 * shared table, no scheduled snapshot and no cross database join, because the two
 * databases belong to two services and the architecture rests on them never being
 * joined. The gateway fans out to both in parallel and composes the response.
 */
export const STATS_PATTERNS = {
  /** Answered by auth: identity totals. */
  identity: 'stats.identity',
  /** Answered by core: zone and content totals. */
  core: 'stats.core',
} as const;

/**
 * Neither subject takes an argument: the totals are the whole platform's, not a
 * caller's. The empty request is named so the schema registry has something to
 * point at, and so a future filter has an obvious home.
 */
export type StatsRequest = Record<string, never>;

export interface IdentityStats {
  /** Every user row, both kinds. */
  users: number;
  /** `kind = REGISTERED`. */
  registeredUsers: number;
  /** `kind = TEMPORARY`: guests holding a zone token. */
  temporaryUsers: number;
}

export interface CoreStats {
  /** Every zone row, both statuses. */
  zones: number;
  /** `status = ACTIVE`: excludes zones marked for deletion. */
  activeZones: number;
}

/**
 * What `GET /v1/stats` returns (plan 0017, section 8.2). Either block is `null`
 * when its service did not answer: a broken auth service must not take down a
 * public page. `measuredAt` reports when the snapshot was taken, so the 60 second
 * cache's staleness is visible rather than hidden.
 */
export interface PlatformStatsResponse {
  identity: IdentityStats | null;
  core: CoreStats | null;
  measuredAt: string;
}
