/**
 * An error as a code and one line of text (plan 0158).
 *
 * **Why this exists.** An error that crosses NATS does not arrive as an
 * `Error`. The client proxy rejects with the plain {@link ProblemDetails}
 * object the other service's exception filter built, so the usual
 * `error instanceof Error ? error.message : String(error)` falls through to
 * `String(error)` and the operator reads `[object Object]` where catalog had
 * written a sentence.
 *
 * Reads, in order:
 *
 * - an `Error`: its message, and its `code` when it carries a string one (a
 *   `DomainException` does);
 * - a problem object, bare or nested under `error` as NATS sometimes delivers
 *   it: its `detail`, which is what the thrower wrote, before its `message`,
 *   which is the localized sentence for the code and says less;
 * - a string: itself;
 * - anything else: a fixed sentence, never `[object Object]`.
 */
export function describeError(error: unknown): {
  code?: string;
  message: string;
} {
  if (error instanceof Error) {
    const code = stringField(error, 'code');
    return code ? { code, message: error.message } : { message: error.message };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  for (const candidate of [error, fieldOf(error, 'error')]) {
    const text =
      stringField(candidate, 'detail') ?? stringField(candidate, 'message');
    if (text) {
      const code = stringField(candidate, 'code');
      return code ? { code, message: text } : { message: text };
    }
  }
  return { message: 'Unknown error.' };
}

function fieldOf(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const field = fieldOf(value, key);
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}
