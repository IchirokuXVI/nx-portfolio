/**
 * The standard paginated response envelope (plan 0004, section 11), defined in
 * contracts so both core and the gateway agree on the shape. Cursor based:
 * `nextCursor` is an opaque token, or `null` at the end.
 */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** The shared page query a caller sends for any collection endpoint. */
export interface PageQuery {
  cursor?: string;
  limit?: number;
  order?: string;
}
