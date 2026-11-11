/**
 * What a catalog discovery's report says about copies and details (admin plan
 * 0029, section 6), and what it did not read (admin plan 0071).
 *
 * `harvest_runs.report` is a free form bag the runner and the executor fill in,
 * so every value is read from `unknown` and a shape this build does not expect
 * reads as absent rather than as a thrown error. The fields are backend plan
 * 0118's `copies` and plan 0119's detail counts and resolved settings, the
 * parts the Carrefour, DEZA and El Jamón walks name as unread or short
 * (backend plans 0251, 0253, 0257 and 0258), and the sizes any walk found
 * disproved by their own price (backend plan 0249).
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

/** A Carrefour category asked for once more at the end (backend plan 0251). */
export interface RunReportAskedAgain {
  readonly id: string;
  readonly name: string;
  /** Whether the second ask read it. */
  readonly read: boolean;
}

/** Why a DEZA section's enumeration stopped (backend plan 0251, section 2). */
export const SECTION_STOPS = [
  'BUDGET',
  'BARREN',
  'GROWTH',
  'NO_TERM',
  'COMPLETE',
] as const;

export type SectionStop = (typeof SECTION_STOPS)[number];

/** One DEZA section, as `sections` names it (backend plan 0257, section 2). */
export interface RunReportSection {
  readonly code: string;
  readonly name: string;
  readonly products: number;
  /** Null for a section that threw, where the count is not known. */
  readonly queries: number | null;
  /** Null for a section that threw, or for a word this build does not know. */
  readonly stoppedBy: SectionStop | null;
  /** The capped queries never narrowed, which a `GROWTH` section draws. */
  readonly openQueries: readonly string[];
  /** Whether `incompleteSections` names it. */
  readonly unfinished: boolean;
}

/** An El Jamón category whose rows read differ from its printed count. */
export interface RunReportCategory {
  readonly code: string;
  readonly name: string;
  readonly printedCount: number;
  readonly rowsRead: number;
  readonly rowsRepeated: number;
}

/** The El Jamón detail stage, in the counts its sentence names (plan 0253). */
export interface RunReportDetailStage {
  readonly pages: number;
  readonly failed: number;
  readonly timeouts: number;
}

/** One row whose stated size its own price disproves (backend plan 0249). */
export interface RunReportSizeExample {
  /** `''` when the report names no entry. */
  readonly entryId: string;
  readonly name: string;
  /** The stated size, in the base unit, for the whole pack. */
  readonly stated: number;
  /** The size the price and the comparison price imply, in the same unit. */
  readonly implied: number;
  /** `GRAM`, `MILLILITER` or `UNIT`, as the report states it. */
  readonly unit: string;
  /** The price label that disproved it, or `''`. */
  readonly label: string;
}

/** The size doubts of a walk. */
export interface RunReportSizes {
  readonly disproved: number;
  /** How many look like a pack of a whole number: a guess, never a fact. */
  readonly probablePackCounts: number;
  readonly examples: readonly RunReportSizeExample[];
}

export interface RunReportView {
  readonly copies: readonly RunReportCopy[];
  /** Null for a run whose report names none of the three counts. */
  readonly details: RunReportDetails | null;
  /** The resolved `writes`, or `''` when the report does not say. */
  readonly writes: string;
  /** The resolved `details`, or `''` when the report does not say. */
  readonly detailFetch: string;
  /** The Carrefour category addresses no ask could read. */
  readonly unreadable: readonly string[];
  readonly askedAgain: readonly RunReportAskedAgain[];
  /** Why a Carrefour walk stopped early, or `''` when it did not. */
  readonly blockedAfter: string;
  /** The DEZA sections, the unfinished ones first. */
  readonly sections: readonly RunReportSection[];
  /** The El Jamón categories that read short or long against their print. */
  readonly categories: readonly RunReportCategory[];
  /** Null for a run whose report has no detail stage. */
  readonly detailStage: RunReportDetailStage | null;
  /** Null for a walk that found no size disproved. */
  readonly sizes: RunReportSizes | null;
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
    unreadable: strings(bag['unreadableCategories']),
    askedAgain: records(bag['askedAgain']).flatMap(
      (entry): RunReportAskedAgain[] =>
        typeof entry['id'] === 'string' &&
        typeof entry['name'] === 'string' &&
        typeof entry['read'] === 'boolean'
          ? [{ id: entry['id'], name: entry['name'], read: entry['read'] }]
          : []
    ),
    blockedAfter:
      typeof bag['blockedAfter'] === 'string' ? bag['blockedAfter'] : '',
    sections: readSections(bag),
    categories: readCategories(bag['categories']),
    detailStage: readDetailStage(bag['detail']),
    sizes: readSizes(bag),
  };
}

/** Whether the report holds anything the run page draws. */
export function reportHasContent(report: RunReportView): boolean {
  return (
    report.writes !== '' ||
    report.detailFetch !== '' ||
    report.details !== null ||
    report.copies.length > 0 ||
    report.unreadable.length > 0 ||
    report.askedAgain.length > 0 ||
    report.blockedAfter !== '' ||
    report.sections.length > 0 ||
    report.categories.length > 0 ||
    report.detailStage !== null ||
    report.sizes !== null
  );
}

/** How many of a copy's targets are drawn before the rest collapse. */
export const COPY_TARGETS_SHOWN = 5;

/**
 * The DEZA sections: the ones `incompleteSections` names first, and otherwise
 * in the order the run began them.
 */
function readSections(bag: Record<string, unknown>): RunReportSection[] {
  const incomplete = new Set(
    records(bag['incompleteSections']).flatMap((entry) =>
      typeof entry['code'] === 'string' ? [entry['code']] : []
    )
  );

  const sections = records(bag['sections']).flatMap(
    (entry): RunReportSection[] => {
      const products = count(entry['products']);
      if (
        typeof entry['code'] !== 'string' ||
        typeof entry['name'] !== 'string' ||
        products === null
      ) {
        return [];
      }
      return [
        {
          code: entry['code'],
          name: entry['name'],
          products,
          queries: count(entry['queries']),
          stoppedBy: sectionStop(entry['stoppedBy']),
          openQueries: strings(entry['openQueries']),
          unfinished: incomplete.has(entry['code']),
        },
      ];
    }
  );

  return [
    ...sections.filter((section) => section.unfinished),
    ...sections.filter((section) => !section.unfinished),
  ];
}

/**
 * The El Jamón categories whose rows read differ from the count the site
 * printed. A category that printed no count is left out: its warning says so,
 * and a row with nothing to read against says nothing here.
 */
function readCategories(value: unknown): RunReportCategory[] {
  return records(value).flatMap((entry): RunReportCategory[] => {
    const printedCount = count(entry['printedCount']);
    const rowsRead = count(entry['rowsRead']);
    if (
      typeof entry['code'] !== 'string' ||
      typeof entry['name'] !== 'string' ||
      printedCount === null ||
      rowsRead === null ||
      rowsRead === printedCount
    ) {
      return [];
    }
    return [
      {
        code: entry['code'],
        name: entry['name'],
        printedCount,
        rowsRead,
        rowsRepeated: count(entry['rowsRepeated']) ?? 0,
      },
    ];
  });
}

function readDetailStage(value: unknown): RunReportDetailStage | null {
  if (!isRecord(value)) {
    return null;
  }
  const pages = count(value['pages']);
  const failed = count(value['failed']);
  const timeouts = count(value['timeouts']);
  return pages === null || failed === null || timeouts === null
    ? null
    : { pages, failed, timeouts };
}

/** The size doubts, for a walk that found at least one. */
function readSizes(bag: Record<string, unknown>): RunReportSizes | null {
  const disproved = count(bag['sizesDisproved']);
  if (disproved === null || disproved <= 0) {
    return null;
  }

  return {
    disproved,
    probablePackCounts: count(bag['probablePackCounts']) ?? 0,
    examples: records(bag['sizesDisprovedExamples']).flatMap(
      (entry): RunReportSizeExample[] => {
        const stated = count(entry['stated']);
        const implied = count(entry['implied']);
        if (
          typeof entry['name'] !== 'string' ||
          typeof entry['unit'] !== 'string' ||
          stated === null ||
          implied === null
        ) {
          return [];
        }
        return [
          {
            entryId:
              typeof entry['entryId'] === 'string' ? entry['entryId'] : '',
            name: entry['name'],
            stated,
            implied,
            unit: entry['unit'],
            label: typeof entry['label'] === 'string' ? entry['label'] : '',
          },
        ];
      }
    ),
  };
}

function sectionStop(value: unknown): SectionStop | null {
  return SECTION_STOPS.find((stop) => stop === value) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
