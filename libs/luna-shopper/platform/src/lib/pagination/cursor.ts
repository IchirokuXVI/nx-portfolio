/**
 * Cursor pagination (plan 0004, section 11).
 *
 * Every collection endpoint is paginated from the start, cursor based rather than
 * offset, so results stay correct while rows are inserted concurrently. The cursor
 * is an opaque base64url token over a stable sort key (and the chosen order, so
 * paging stays consistent); the response envelope is `{ items, nextCursor }` with
 * a page size capped at a maximum.
 */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Standard paginated response envelope. */
export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or `null` at the end. */
  nextCursor: string | null;
}

/** Clamps a requested page size into `[1, MAX_PAGE_SIZE]`, defaulting when unset. */
export function clampPageSize(requested?: number): number {
  if (!requested || Number.isNaN(requested) || requested < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}

/**
 * Encodes a cursor payload (the sort key values and the chosen order) into an
 * opaque base64url token. The payload shape is the endpoint's concern; keeping the
 * order inside the token is what makes paging consistent even if the caller resends
 * a different `order`.
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor back into its payload, or `undefined` if it is missing
 * or malformed (an endpoint treats a bad cursor as "start from the beginning"
 * rather than erroring).
 */
export function decodeCursor<T extends Record<string, unknown>>(
  cursor: string | null | undefined
): T | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as T)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds a {@link Page} from a fetched slice. Endpoints fetch `limit + 1` rows to
 * learn whether another page exists; pass the trimmed `items` and a builder that
 * turns the last item into its cursor.
 */
export function buildPage<T>(
  items: T[],
  hasMore: boolean,
  toCursor: (last: T) => string
): Page<T> {
  const nextCursor =
    hasMore && items.length > 0 ? toCursor(items[items.length - 1]) : null;
  return { items, nextCursor };
}
