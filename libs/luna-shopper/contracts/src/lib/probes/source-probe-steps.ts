import type {
  SourceProbeResult,
  SourceProbeStepView,
} from '../messages/source-probe.messages';

/**
 * The parts every chain's `probe` function shares (plan 0219, section 3.1).
 *
 * Framework free and browser reachable, as the rest of this library is: the
 * six adapter libraries import it, and each one keeps its own steps, floors
 * and fields beside its parsers.
 */

/** A few parsed values for a person to read. */
export type SourceProbeSample = Record<
  string,
  string | number | boolean | null
>;

/** What a step's check says about the value its read answered. */
export interface SourceProbeCheck {
  /** One sentence per thing the parser read wrong. Empty when ok. */
  problems: string[];
  sample?: SourceProbeSample;
  /** The URL the step read, when only the value names it. */
  url?: string | null;
}

/** At most this many values in a step's sample (section 3.1). */
export const SOURCE_PROBE_SAMPLE_LIMIT = 6;

/** The share of listing rows that must carry every required field. */
export const SOURCE_PROBE_ROW_SHARE = 0.8;

/**
 * Runs the steps of one probe in order and stops at the first one that is not
 * ok, because a later step reads an id or a path out of an earlier one.
 *
 * A step that throws is not ok, with `httpStatus` from the error's `status`
 * when it is a number and `error` from its message. The exception itself is
 * kept as the result's `failure`, so the caller can classify it.
 */
export class SourceProbeRecorder {
  private readonly steps: SourceProbeStepView[] = [];
  private failure: unknown = undefined;
  private halted = false;

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /** True once a step was not ok. Every later step is skipped. */
  get stopped(): boolean {
    return this.halted;
  }

  /**
   * One step: `read` makes the requests, `check` judges what they answered.
   * Answers the value when the step is ok, and undefined otherwise.
   */
  async step<T>(
    name: string,
    url: string | null,
    read: () => Promise<T>,
    check: (value: T) => SourceProbeCheck
  ): Promise<T | undefined> {
    if (this.halted) {
      return undefined;
    }
    const startedAt = this.clock();
    let value: T;
    try {
      value = await read();
    } catch (error) {
      if (error instanceof SourceProbeShapeProblem) {
        this.push(name, url, startedAt, [error.message], {});
        return undefined;
      }
      this.fail(name, url, startedAt, error);
      return undefined;
    }
    let verdict: SourceProbeCheck;
    try {
      verdict = check(value);
    } catch (error) {
      this.fail(name, url, startedAt, error);
      return undefined;
    }
    const ok = this.push(
      name,
      verdict.url !== undefined ? verdict.url : url,
      startedAt,
      verdict.problems,
      verdict.sample ?? {}
    );
    return ok ? value : undefined;
  }

  /** The steps so far, the request count the caller kept, and the failure. */
  result(requests: number): SourceProbeResult {
    const result: SourceProbeResult = { steps: [...this.steps], requests };
    if (this.failure !== undefined) {
      result.failure = this.failure;
    }
    return result;
  }

  /** Records a step that ended with an answer. Not ok when it has problems. */
  private push(
    name: string,
    url: string | null,
    startedAt: number,
    problems: readonly string[],
    sample: SourceProbeSample
  ): boolean {
    const ok = problems.length === 0;
    this.steps.push({
      name,
      url,
      ok,
      httpStatus: null,
      error: null,
      problems: [...problems],
      sample: trimSample(sample),
      durationMs: Math.max(0, this.clock() - startedAt),
    });
    if (!ok) {
      this.halted = true;
    }
    return ok;
  }

  private fail(
    name: string,
    url: string | null,
    startedAt: number,
    error: unknown
  ): void {
    this.failure = error;
    this.halted = true;
    this.steps.push({
      name,
      url: urlOf(error) ?? url,
      ok: false,
      httpStatus: httpStatusOf(error),
      error: messageOf(error),
      problems: [],
      sample: {},
      durationMs: Math.max(0, this.clock() - startedAt),
    });
  }
}

/** A parser error the library recognized, carried out of a step's read. */
class SourceProbeShapeProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceProbeShapeProblem';
  }
}

/**
 * Wraps a step's `read` so that a parser error the library recognizes is a
 * problem and not an exception (plan 0219, section 5).
 *
 * Some parsers throw a plain `Error` when the source answered and what it
 * answered is not the shape they read: a header that is gone, a document that
 * names no file. Recorded as an exception, that step would be judged `ERROR`.
 * Through this wrapper the step is not ok, its one problem is the error's
 * message, and it has no `httpStatus` and no `error`, so it is judged
 * `SHAPE_CHANGED`. Any error `recognizes` does not name is thrown on as it was.
 */
export function parserErrorsAsProblems<T>(
  read: () => Promise<T>,
  recognizes: (error: unknown) => boolean
): () => Promise<T> {
  return async () => {
    try {
      return await read();
    } catch (error) {
      if (recognizes(error)) {
        throw new SourceProbeShapeProblem(messageOf(error));
      }
      throw error;
    }
  };
}

/** The numeric `status` an adapter's HTTP error carries, or null. */
export function httpStatusOf(error: unknown): number | null {
  const status =
    error !== null && typeof error === 'object'
      ? (error as { status?: unknown }).status
      : undefined;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

/** The message of an exception, or the thrown value as text. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function urlOf(error: unknown): string | null {
  const url =
    error !== null && typeof error === 'object'
      ? (error as { url?: unknown }).url
      : undefined;
  return typeof url === 'string' && url !== '' ? url : null;
}

function trimSample(sample: SourceProbeSample): SourceProbeSample {
  return Object.fromEntries(
    Object.entries(sample).slice(0, SOURCE_PROBE_SAMPLE_LIMIT)
  );
}

/** A problem when `count` is under `floor`, and none otherwise. */
export function belowFloor(
  count: number,
  floor: number,
  what: string
): string[] {
  return count >= floor
    ? []
    : [`${count} ${what} were read, and the floor is ${floor}`];
}

/**
 * The 80 per cent rule (section 3.1): at least one row, and at least 80 per
 * cent of the rows carry each required field. A product with no brand is
 * real. A page where most rows lost their brand is a change.
 *
 * Each problem names the field, as `fields` labels it.
 */
export function mostRowsCarry<T>(
  rows: readonly T[],
  fields: Record<string, (row: T) => boolean>,
  what = 'rows'
): string[] {
  if (rows.length === 0) {
    return [`no ${what} were read`];
  }
  const problems: string[] = [];
  for (const [field, carries] of Object.entries(fields)) {
    const carried = rows.filter((row) => safely(carries, row)).length;
    if (carried < rows.length * SOURCE_PROBE_ROW_SHARE) {
      problems.push(`${carried} of ${rows.length} ${what} carried ${field}`);
    }
  }
  return problems;
}

function safely<T>(carries: (row: T) => boolean, row: T): boolean {
  try {
    return carries(row);
  } catch {
    return false;
  }
}

/** A string with something in it. */
export function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** A finite number above zero. */
export function isPositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** A finite number. */
export function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The gate a probe hands a client as its `acquire`: the caller's own, which is
 * the run's token bucket at the row's rate, and then a least interval between
 * two requests (section 3.4).
 *
 * Several clients drop their own interval once an `acquire` is passed, because
 * a walk's bucket is meant to replace it. A probe is not in a hurry, so it keeps
 * both, and is never faster than a walk.
 */
export function pacedAcquire(options: {
  acquire?: () => Promise<void>;
  minIntervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): () => Promise<void> {
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  let last: number | null = null;
  return async () => {
    await options.acquire?.();
    if (last !== null && options.minIntervalMs > 0) {
      const wait = last + options.minIntervalMs - now();
      if (wait > 0) {
        await sleep(wait);
      }
    }
    last = now();
  };
}

/**
 * Counts the requests a probe makes through a `fetch`, for the clients that do
 * not count their own.
 */
export function countingFetch(fetchImpl: typeof fetch): {
  fetchImpl: typeof fetch;
  count: () => number;
} {
  let requests = 0;
  const counted = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests += 1;
    return fetchImpl(input, init);
  }) as typeof fetch;
  return { fetchImpl: counted, count: () => requests };
}
