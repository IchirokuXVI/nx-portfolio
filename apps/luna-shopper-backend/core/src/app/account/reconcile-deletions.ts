import {
  EXISTING_USER_IDS_MAX,
  type ExistingUserIdsResponse,
} from '@portfolio/luna-shopper/contracts';

/**
 * Every user id core holds in a column of plan 0232 section 2, and the ids of
 * the `user.deleted:<userId>` keys plan 0011 wrote, which name only accounts
 * that are gone. Sorted, so two runs ask auth in the same order. A user
 * deleted by the orphan reaper may have left nothing but that key, and the
 * deletion removes it.
 */
export const CORE_USER_IDS_SQL = `
  SELECT DISTINCT t."id"::text AS "id" FROM (
    SELECT "userId" AS "id" FROM "zone_memberships"
    UNION SELECT "approvedByUserId" FROM "zone_memberships"
    UNION SELECT "createdByUserId" FROM "shopping_lists"
    UNION SELECT "createdByUserId" FROM "list_lines"
    UNION SELECT "approvedByUserId" FROM "list_lines"
    UNION SELECT "deletedByUserId" FROM "list_lines"
    UNION SELECT "authorUserId" FROM "line_comments"
    UNION SELECT "actorUserId" FROM "list_line_changes"
    UNION SELECT "sourceUserId" FROM "merge_requests"
    UNION SELECT "targetUserId" FROM "merge_requests"
    UNION SELECT "requestedByUserId" FROM "merge_requests"
    UNION SELECT "resolvedByUserId" FROM "merge_requests"
    UNION SELECT "userId" FROM "basket_participants"
    UNION SELECT "invitedByUserId" FROM "basket_participants"
    UNION SELECT "settledByUserId" FROM "line_settlements"
    UNION SELECT "ownerUserId" FROM "baskets"
    UNION SELECT "ownerUserId" FROM "zones"
    UNION SELECT "userId" FROM "shopping_profiles"
    UNION SELECT "userId" FROM "user_app_state"
    UNION SELECT "userId" FROM "assistant_usage_days"
    UNION SELECT "userId" FROM "assistant_reservations"
    UNION SELECT substr("key", 14)::uuid FROM "processed_events"
     WHERE "key" ~ '^user\\.deleted:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) t
  WHERE t."id" IS NOT NULL
    -- A tombstone is no account (\`TOMBSTONE_PREFIX\`), so a second run of the
    -- release task does not rewrite what the first one wrote.
    AND t."id"::text NOT LIKE '00000000-%'
  ORDER BY 1`;

/** What a run needs, so the entry point and a spec can each supply their own. */
export interface ReconcileDeps {
  /** Every candidate id, as {@link CORE_USER_IDS_SQL} answers it. */
  candidates(): Promise<string[]>;
  /** `auth.existingUserIds` for at most {@link EXISTING_USER_IDS_MAX} ids. */
  existing(userIds: string[]): Promise<ExistingUserIdsResponse>;
  /** The deletion of one id, the one the stream runs. True when it applied. */
  delete(userId: string): Promise<boolean>;
  log(line: string): void;
}

export interface ReconcileOptions {
  /** Count only, and change nothing. */
  countOnly: boolean;
  /** Refuse to delete anything when more ids than this are unknown to auth. */
  max: number | null;
}

/**
 * The one off command of plan 0232, section 7: run the deletion for every id
 * core holds that auth does not know. Answers how many ids auth does not know.
 *
 * Auth is asked in batches, and its answer must be a subset of the question. An
 * answer that names an id it was not asked about is a refusal, because the
 * difference between the two is what gets deleted.
 */
export async function reconcileDeletions(
  deps: ReconcileDeps,
  options: ReconcileOptions
): Promise<number> {
  const candidates = await deps.candidates();
  const unknown: string[] = [];
  for (let at = 0; at < candidates.length; at += EXISTING_USER_IDS_MAX) {
    const batch = candidates.slice(at, at + EXISTING_USER_IDS_MAX);
    const answer = await deps.existing(batch);
    if (!answer || !Array.isArray(answer.userIds)) {
      throw new Error('auth answered auth.existingUserIds with no userIds');
    }
    const asked = new Set(batch);
    const known = new Set(answer.userIds.map((id) => String(id).toLowerCase()));
    for (const id of known) {
      if (!asked.has(id)) {
        throw new Error(`auth answered an id it was not asked about: ${id}`);
      }
    }
    unknown.push(...batch.filter((id) => !known.has(id)));
  }

  deps.log(`candidates ${candidates.length}`);
  deps.log(`unknown ${unknown.length}`);
  if (options.countOnly) {
    return unknown.length;
  }
  if (options.max !== null && unknown.length > options.max) {
    throw new Error(
      `${unknown.length} ids are unknown to auth, above the ceiling of ${options.max}. Nothing was deleted.`
    );
  }

  let applied = 0;
  for (const userId of unknown) {
    if (await deps.delete(userId)) {
      applied += 1;
    }
  }
  deps.log(`applied ${applied}`);
  return unknown.length;
}

/** `--count` and `--max <n>` from the command line, or an error. */
export function parseReconcileArgs(argv: readonly string[]): ReconcileOptions {
  const options: ReconcileOptions = { countOnly: false, max: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--count') {
      options.countOnly = true;
    } else if (arg === '--max') {
      const value = argv[i + 1] ?? '';
      if (!/^\d+$/.test(value)) {
        throw new Error(`--max needs a whole number, and got '${value}'`);
      }
      options.max = Number(value);
      i += 1;
    } else {
      throw new Error(`unknown argument '${arg}'. Use --count or --max <n>.`);
    }
  }
  return options;
}
