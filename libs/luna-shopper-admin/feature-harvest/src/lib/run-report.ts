/**
 * What a catalog discovery's report says about copies and details (admin plan
 * 0029, section 6).
 *
 * `harvest_runs.report` is a free form bag the runner and the executor fill in,
 * so every value is read from `unknown` and a shape this build does not expect
 * reads as absent rather than as a thrown error. The fields are backend plan
 * 0118's `copies` and plan 0119's detail counts and resolved settings.
 */

/** One walked scope and the scopes it was copied to. */
export interface RunReportCopy {
  readonly from: string;
  readonly to: readonly string[];
  readonly pricesCopied: number;
  readonly availabilityCopied: number;
}

/** The detail phase, in the three numbers the runner reports. */
export interface RunReportDetails {
  /** Detail requests made. */
  readonly requested: number;
  /** Known products reported from the listing, with no request. */
  readonly skipped: number;
  /** Products fetched again because their row has no EAN. */
  readonly withoutEan: number;
}

export interface RunReportView {
  readonly copies: readonly RunReportCopy[];
  /** Null for a run whose report names none of the three counts. */
  readonly details: RunReportDetails | null;
  /** The resolved `writes`, or `''` when the report does not say. */
  readonly writes: string;
  /** The resolved `details`, or `''` when the report does not say. */
  readonly detailFetch: string;
}

export function readRunReport(report: unknown): RunReportView {
  const bag = isRecord(report) ? report : {};

  const copies = Array.isArray(bag['copies'])
    ? bag['copies'].flatMap((entry): RunReportCopy[] => {
        if (!isRecord(entry) || typeof entry['from'] !== 'string') {
          return [];
        }
        const to = Array.isArray(entry['to'])
          ? entry['to'].filter((id): id is string => typeof id === 'string')
          : [];
        return [
          {
            from: entry['from'],
            to,
            pricesCopied: count(entry['pricesCopied']) ?? 0,
            availabilityCopied: count(entry['availabilityCopied']) ?? 0,
          },
        ];
      })
    : [];

  const requested = count(bag['productsDetailed']);
  const skipped = count(bag['productsDetailSkipped']);
  const withoutEan = count(bag['productsWithoutEan']);
  // `productsDetailed` alone predates backend plan 0119, when it counted the
  // union rather than requests made, so the counts are drawn only beside the
  // skipped count that gives them that meaning.
  const details =
    skipped === null
      ? null
      : {
          requested: requested ?? 0,
          skipped,
          withoutEan: withoutEan ?? 0,
        };

  return {
    copies,
    details,
    writes: typeof bag['writes'] === 'string' ? bag['writes'] : '',
    detailFetch: typeof bag['details'] === 'string' ? bag['details'] : '',
  };
}

/** How many of a copy's targets are drawn before the rest collapse. */
export const COPY_TARGETS_SHOWN = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
