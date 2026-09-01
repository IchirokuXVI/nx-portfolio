import type {
  ZoneCounts,
  ZoneListPreview,
} from '@portfolio/luna-shopper/contracts';
import { ZONE_SUMMARY_COLUMNS } from './zone-summary.sql';

/**
 * Turns the raw columns {@link selectZoneSummary} adds into the typed summary
 * (plan 0017, section 3). The counts arrive as `json_build_object` values and
 * the preview as a `json_agg` array, so `pg` has already parsed them; everything
 * here is defensive shaping, not parsing.
 *
 * The gating in section 6 is deliberately NOT applied here: this reader reports
 * what the database holds, and `toMyZoneView` decides what the caller may see.
 * Keeping the two apart is what lets the realtime staff room reuse the same
 * numbers with the governance fields filled.
 */

/** One raw row from `getRawAndEntities()`, indexed loosely by column alias. */
export type SummaryRow = Record<string, unknown> | undefined;

function count(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
}

/** The member and pending totals, both of which ride one raw JSON column. */
export function readZoneMemberCounts(row: SummaryRow): {
  memberCount: number;
  pendingRequestCount: number;
} {
  const raw = row?.[ZONE_SUMMARY_COLUMNS.memberCounts] as
    | { memberCount?: unknown; pendingRequestCount?: unknown }
    | null
    | undefined;
  return {
    memberCount: count(raw?.memberCount),
    pendingRequestCount: count(raw?.pendingRequestCount),
  };
}

/** The full, ungated counts for one zone row. */
export function readZoneCounts(row: SummaryRow): ZoneCounts {
  const members = readZoneMemberCounts(row);
  const firstPending = row?.[ZONE_SUMMARY_COLUMNS.firstPending];
  return {
    memberCount: members.memberCount,
    listCount: count(row?.[ZONE_SUMMARY_COLUMNS.listCount]),
    pendingRequestCount: members.pendingRequestCount,
    firstPendingRequesterName:
      typeof firstPending === 'string' ? firstPending : null,
  };
}

/**
 * The owner's per zone name for one zone row, or null when the zone has no owner
 * (plan 0024, section 2). Unlike the governance counts this is not gated: a
 * pending applicant is shown who to nudge, and the exchange is symmetric because
 * the owner already sees the applicant's handle in their pending list.
 */
export function readZoneOwnerUsername(row: SummaryRow): string | null {
  const raw = row?.[ZONE_SUMMARY_COLUMNS.ownerUsername];
  return typeof raw === 'string' ? raw : null;
}

/**
 * The lists preview for one zone row. An absent or malformed column becomes an
 * empty array, which is a legitimate value meaning "the caller can read no list
 * here" and always agrees with a `listCount` of zero (plan 0017, section 3.3).
 */
export function readZoneListsPreview(row: SummaryRow): ZoneListPreview[] {
  const raw = row?.[ZONE_SUMMARY_COLUMNS.listsPreview];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry) => {
    const preview = entry as Record<string, unknown>;
    return {
      id: String(preview['id']),
      name: String(preview['name']),
      lineCount: count(preview['lineCount']),
      wantedCount: count(preview['wantedCount']),
    };
  });
}
