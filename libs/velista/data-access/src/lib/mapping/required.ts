/**
 * The one place a mapper's `null` becomes a thrown failure.
 *
 * A mapper returns `null` for a record it cannot render (rule D4), and most callers
 * have somewhere sensible to put that: a list drops the row, a page renders an empty
 * state. A single-record write does not. `POST .../approve` answering something
 * unreadable leaves the caller with no membership to reconcile against, and quietly
 * carrying on would put a row on screen that no longer matches anything on the server.
 *
 * Deliberately a plain `Error` and **not** a `GatewayError`. The request succeeded;
 * what failed is this build's ability to read the answer, and dressing that as a server
 * error would send somebody a correlation id for a request the server handled fine. It
 * reaches the caller's `failed` branch either way, where the generic copy is right.
 *
 * Separate from `primitives.ts` because that file's rule is that nothing in it throws,
 * and separate from `mappers.ts` because a mapper's whole contract is that it does not.
 */
export function required<T>(value: T | null, operation: string): T {
  if (value === null) {
    throw new Error(`${operation} returned a response this build cannot read`);
  }

  return value;
}
