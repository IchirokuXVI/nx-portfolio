import {
  EXISTING_USER_IDS_MAX,
  type ExistingUserIdsResponse,
} from '@portfolio/luna-shopper/contracts';

/**
 * Every user id catalog holds in a column of plan 0232 section 2: who recorded
 * a shop walk and its entries. Sorted, so two runs ask auth in the same order.
 */
export const CATALOG_USER_IDS_SQL = `
  SELECT DISTINCT t."id"::text AS "id" FROM (
    SELECT "createdByUserId" AS "id" FROM "shop_walks"
    UNION SELECT "createdByUserId" FROM "shop_walk_entries"
  ) t
  WHERE t."id" IS NOT NULL
    -- A tombstone is no account (\`TOMBSTONE_PREFIX\`), so a second run of the
    -- release task does not rewrite what the first one wrote.
    AND t."id"::text NOT LIKE '00000000-%'
  ORDER BY 1`;

export interface ReconcileDeps {
  candidates(): Promise<string[]>;
  /** `auth.existingUserIds` for at most {@link EXISTING_USER_IDS_MAX} ids. */
  existing(userIds: string[]): Promise<ExistingUserIdsResponse>;
  /** The deletion the stream runs. Answers the rows it rewrote. */
  delete(userId: string): Promise<number>;
  log(line: string): void;
}

export interface ReconcileOptions {
  countOnly: boolean;
  max: number | null;
}

/**
 * Catalog's one off command of plan 0232, section 7, the same steps as core's:
 * ask auth in batches, refuse an answer that is not a subset of the question,
 * and rewrite the walks of every id auth does not know. Answers how many.
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
      `${unknown.length} ids are unknown to auth, above the ceiling of ${options.max}. Nothing was changed.`
    );
  }
  let rewritten = 0;
  for (const userId of unknown) {
    rewritten += await deps.delete(userId);
  }
  deps.log(`rewritten ${rewritten}`);
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
