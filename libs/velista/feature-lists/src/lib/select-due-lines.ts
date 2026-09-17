import {
  DUE_LINES_SHOWN,
  type DueLine,
  type DueLineRowVm,
  type LineRowVm,
} from '@portfolio/velista/models';

/** Everything `selectDueLines` needs beside the composed due rows. */
export interface DueLinesInput {
  /** The due lines `composeListGroups` kept, as rows, in the server's order. */
  readonly rows: readonly LineRowVm[];
  /** The server's due line for a line id, or undefined. */
  readonly dueOf: (lineId: string) => DueLine | undefined;
  readonly locale: string;
  /** Whether "Show more suggestions" was pressed on this visit. */
  readonly expanded: boolean;
}

export interface DueLinesVm {
  /** The rows to draw: the first {@link DUE_LINES_SHOWN}, or every one once expanded. */
  readonly rows: readonly DueLineRowVm[];
  /** How many more rows "Show more suggestions" would draw. Zero hides the button. */
  readonly hiddenCount: number;
}

/**
 * The due rows as `lib-due-line-row` draws them (velista `0089`, section 2).
 *
 * Pure, so the rules about who is offered what are tested without a page.
 *
 * **Only rows the reader can adjust.** A suggestion that cannot be taken is noise, so a
 * reader, and a writer who may not change a quantity, get no row and so no section.
 *
 * **Three, then all.** The server answers every due line and the section draws the
 * first {@link DUE_LINES_SHOWN}. Taking one of them draws the next in its place at once,
 * because the rest are already held.
 */
export function selectDueLines(input: DueLinesInput): DueLinesVm {
  const relative = relativeDays(input.locale);

  const all: DueLineRowVm[] = [];
  for (const row of input.rows) {
    const due = input.dueOf(row.id);
    if (due === undefined || !row.adjustable) {
      continue;
    }
    all.push({
      lineId: row.id,
      name: row.content,
      quantity: due.quantity,
      ...reasonOf(due, relative),
    });
  }

  const rows = input.expanded ? all : all.slice(0, DUE_LINES_SHOWN);
  return { rows, hiddenCount: all.length - rows.length };
}

function reasonOf(
  due: DueLine,
  relative: (days: number) => string
): Pick<DueLineRowVm, 'reasonKey' | 'reasonArgs'> {
  if (due.reason === 'STAPLE') {
    return {
      reasonKey: 'list.due.staple',
      reasonArgs: { with: due.tripsWith ?? 0, seen: due.tripsSeen ?? 0 },
    };
  }

  const when = relative(due.daysSinceBought);
  return due.periodDays === 1
    ? { reasonKey: 'list.due.periodOne', reasonArgs: { when } }
    : {
        reasonKey: 'list.due.period',
        reasonArgs: { days: due.periodDays ?? 0, when },
      };
}

/**
 * "5 days ago", "yesterday", "today", in the current locale, through
 * `Intl.RelativeTimeFormat` and never a sentence built by hand. An unrecognised tag
 * throws `RangeError`, so it falls back on the runtime's own locale.
 */
function relativeDays(locale: string): (days: number) => string {
  let format: Intl.RelativeTimeFormat;
  try {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  }
  return (days) => format.format(-Math.max(0, days), 'day');
}
