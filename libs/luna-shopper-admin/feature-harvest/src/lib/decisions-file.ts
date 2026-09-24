import type {
  ApplyEntryDecisionsInput,
  EntryDecisionOperation,
} from '@portfolio/luna-shopper-admin/data-access';

/**
 * How many operations one request may carry, which is the route's own cap
 * (`BULK_DECISION_MAX_OPERATIONS`, backend plan 0100). A longer file is refused
 * here rather than split: splitting it would break the all or nothing promise
 * the file was decided under.
 */
export const DECISIONS_MAX_OPERATIONS = 1000;

/** The header line a curation run writes first. */
export interface DecisionsFileHeader {
  readonly runId: string | null;
  /** The gateway the file was decided against. */
  readonly mainUrl: string | null;
  readonly startedAt: string | null;
}

/** One operation, as the review table draws it. */
export interface DecisionsFileRow {
  readonly kind: 'accept' | 'createItem';
  readonly entryId: string;
  /** The row as the chain printed it. */
  readonly entryName: string;
  /**
   * What the operation points at: the product id an accept binds to, the ref
   * of a product this file creates, or the ref a create is known by.
   */
  readonly target: string;
  /** The new product's name, for a create. `null` for an accept. */
  readonly itemName: string | null;
}

/** A decisions file, read and ready to send. */
export interface DecisionsFile {
  readonly header: DecisionsFileHeader;
  readonly rows: readonly DecisionsFileRow[];
  /** The request, exactly as the curation CLI's `--apply` builds it. */
  readonly request: ApplyEntryDecisionsInput;
  /** Rows the file handed back to the queue, which send nothing. */
  readonly reviews: number;
}

/** Why a file could not be read, and on which line when it is one line. */
export type DecisionsFileProblem =
  | { readonly kind: 'notJson'; readonly line: number }
  | { readonly kind: 'noHeader' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'tooMany'; readonly count: number };

/**
 * Read a curation `decisions.jsonl` (admin plan 0035, section 3).
 *
 * The same reading the curation CLI's `apply` makes, line for line, so the app
 * sends what `--apply` would have sent and never changes a decision: the header
 * names the run, a `CREATE` becomes a `createItem`, a `LINK` becomes an
 * `accept`, and a `REVIEW` sends nothing because it was never a decision. The
 * item body is the CLI's `toCreateItemBody`, field for field.
 *
 * No parser dependency: the format is one JSON document per line.
 */
export function parseDecisionsFile(
  text: string
): DecisionsFile | DecisionsFileProblem {
  const lines: Record<string, unknown>[] = [];
  const raw = text.split('\n');

  for (let index = 0; index < raw.length; index++) {
    const trimmed = raw[index].trim();
    if (trimmed === '') {
      continue;
    }
    try {
      const value: unknown = JSON.parse(trimmed);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { kind: 'notJson', line: index + 1 };
      }
      lines.push(value as Record<string, unknown>);
    } catch {
      return { kind: 'notJson', line: index + 1 };
    }
  }

  if (lines.length === 0) {
    return { kind: 'empty' };
  }

  const head = lines.find((line) => line['header'] === true);
  if (head === undefined) {
    return { kind: 'noHeader' };
  }
  const records = lines.filter((line) => line['header'] !== true);

  const operations: EntryDecisionOperation[] = [];
  const rows: DecisionsFileRow[] = [];
  let reviews = 0;

  for (const record of records) {
    const decision = record['decision'];
    const entryId = textOf(record['entryId']);
    const entryName = textOf(record['entryName']);

    if (decision === 'CREATE') {
      const item = asRecord(record['item']);
      const ref = textOf(record['ref']);
      operations.push({
        op: 'createItem',
        entryId,
        ref: record['ref'] as string,
        item: toCreateItemBody(item),
        expect: record['expect'] as EntryDecisionOperation['expect'],
      });
      rows.push({
        kind: 'createItem',
        entryId,
        entryName,
        target: ref,
        itemName: textOf(item['nameEs']) || textOf(item['nameEn']) || null,
      });
    } else if (decision === 'LINK') {
      const itemId = record['itemId'];
      const hasId = typeof itemId === 'string' && itemId !== '';
      operations.push({
        op: 'accept',
        entryId,
        ...(hasId
          ? { itemId: itemId as string }
          : { itemRef: record['itemRef'] as string }),
        expect: record['expect'] as EntryDecisionOperation['expect'],
      });
      rows.push({
        kind: 'accept',
        entryId,
        entryName,
        target: hasId ? (itemId as string) : textOf(record['itemRef']),
        itemName: null,
      });
    } else {
      reviews++;
    }
  }

  if (operations.length > DECISIONS_MAX_OPERATIONS) {
    return { kind: 'tooMany', count: operations.length };
  }

  const runId = head['runId'];
  return {
    header: {
      runId: typeof runId === 'string' ? runId : null,
      mainUrl: typeof head['mainUrl'] === 'string' ? head['mainUrl'] : null,
      startedAt:
        typeof head['startedAt'] === 'string' ? head['startedAt'] : null,
    },
    rows,
    reviews,
    request: typeof runId === 'string' ? { runId, operations } : { operations },
  };
}

/** Whether a read produced a file or a problem. */
export function isDecisionsFile(
  value: DecisionsFile | DecisionsFileProblem
): value is DecisionsFile {
  return 'request' in value;
}

/**
 * The item body `CreateItemDto` names, as the curation CLI builds it.
 *
 * A field the record left out stays out of the request, as it does when the
 * CLI serializes the same object.
 */
function toCreateItemBody(
  item: Record<string, unknown>
): NonNullable<EntryDecisionOperation['item']> {
  const nameEn = item['nameEn'];
  const body: Record<string, unknown> = {
    name: nameEn ? { es: item['nameEs'], en: nameEn } : { es: item['nameEs'] },
    brand: item['brand'],
    ean: item['ean'],
    unitSize: item['unitSize'],
    category: item['category'],
    defaultUnit: item['defaultUnit'],
  };
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) {
      delete body[key];
    }
  }
  return body as NonNullable<EntryDecisionOperation['item']>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** A value as display text, or `''` when it is not a string. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
