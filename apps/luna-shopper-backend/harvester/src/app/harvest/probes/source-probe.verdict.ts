import { CarrefourBrowserError } from '@portfolio/luna-shopper/carrefour';
import {
  SourceProbeStatus,
  type SourceProbeResult,
  type SourceProbeStepView,
} from '@portfolio/luna-shopper/contracts';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';

/** What a finished probe is, and the one sentence that says why. */
export interface SourceProbeVerdict {
  status: SourceProbeStatus;
  error: string | null;
}

/**
 * The verdict of plan 0219, section 5: the first step that is not ok decides
 * the status, in this order.
 *
 * | The step                                                   | Status          |
 * | ---------------------------------------------------------- | --------------- |
 * | `httpStatus` 403 or 429, or a `SourceBlockedError`          | `BLOCKED`       |
 * | `httpStatus` 500 or more, a network error or a timeout      | `UNREACHABLE`   |
 * | `httpStatus` 404 or 410                                     | `SHAPE_CHANGED` |
 * | problems and no exception                                  | `SHAPE_CHANGED` |
 * | any other exception, `CarrefourBrowserError` among them    | `ERROR`         |
 *
 * Every step ok is `PASSED`. A probe a shutdown stopped never reaches here:
 * the service writes it `ABORTED`.
 */
export function judgeProbe(result: SourceProbeResult): SourceProbeVerdict {
  const step = result.steps.find((each) => !each.ok);
  if (!step) {
    return { status: SourceProbeStatus.PASSED, error: null };
  }
  return { status: statusOf(step, result.failure), error: sentence(step) };
}

function statusOf(
  step: SourceProbeStepView,
  failure: unknown
): SourceProbeStatus {
  const status = step.httpStatus;
  if (
    status === 403 ||
    status === 429 ||
    failure instanceof SourceBlockedError
  ) {
    return SourceProbeStatus.BLOCKED;
  }
  if ((status !== null && status >= 500) || isUnreachable(failure)) {
    return SourceProbeStatus.UNREACHABLE;
  }
  if (status === 404 || status === 410) {
    return SourceProbeStatus.SHAPE_CHANGED;
  }
  if (step.error === null && failure === undefined) {
    return SourceProbeStatus.SHAPE_CHANGED;
  }
  return SourceProbeStatus.ERROR;
}

/**
 * The error codes Node's `fetch` puts on a request that got no answer: a
 * refused or reset connection, a name that does not resolve, a socket that
 * timed out.
 */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/**
 * A network error or a timeout: the source did not answer at all.
 *
 * Not a `CarrefourBrowserError`. A browser that stops answering is ours, and a
 * deadline inside it is the browser's deadline, so it stays `ERROR`.
 */
export function isUnreachable(failure: unknown): boolean {
  if (
    failure === null ||
    typeof failure !== 'object' ||
    failure instanceof CarrefourBrowserError
  ) {
    return false;
  }
  // A `DOMException` is not always an `Error` of this realm, so the name decides.
  const name = (failure as { name?: unknown }).name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return true;
  }
  for (
    let error: unknown = failure, depth = 0;
    error && depth < 4;
    depth += 1
  ) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && NETWORK_CODES.has(code)) {
      return true;
    }
    error = (error as { cause?: unknown }).cause;
  }
  // Node's `fetch` says only this when the cause carries no code.
  return failure instanceof TypeError && failure.message === 'fetch failed';
}

/** `listing: 2 of 40 rows carried a price above zero`. */
function sentence(step: SourceProbeStepView): string {
  const first =
    step.problems[0] ??
    step.error ??
    (step.httpStatus !== null ? `answered ${step.httpStatus}` : 'was not ok');
  return `${step.name}: ${first}`;
}
