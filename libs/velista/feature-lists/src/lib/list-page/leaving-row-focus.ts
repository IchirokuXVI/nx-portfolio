/**
 * Where focus goes when a row it was in leaves the list (velista `0192`, section 4):
 * the same control of the next row, else of the previous row, else the list's
 * heading. The control is a stepper button when focus was on one, and the row's own
 * button otherwise.
 */
export interface LeavingRowFocus {
  /** The row to focus, or null for the list's heading. */
  readonly lineId: string | null;
  /** The control in that row, as a selector. */
  readonly control: string;
}

const ROW = 'li.line[data-line-id]';
const STEPPER_BUTTONS = ['.step.minus', '.step.plus'];
const ROW_BUTTON = '.row';

/**
 * Read while the row is still drawn. Null when focus was not in it, so focus is
 * left where it is.
 */
export function focusAfterLeaving(
  column: HTMLElement,
  lineId: string
): LeavingRowFocus | null {
  const rows = Array.from(column.querySelectorAll<HTMLElement>(ROW));
  const at = rows.findIndex((row) => row.dataset['lineId'] === lineId);
  const active = column.ownerDocument.activeElement;
  if (at === -1 || active === null || !rows[at].contains(active)) {
    return null;
  }
  const control =
    STEPPER_BUTTONS.find((selector) => active.matches(selector)) ?? ROW_BUTTON;
  const neighbour = rows[at + 1] ?? rows[at - 1];
  return { lineId: neighbour?.dataset['lineId'] ?? null, control };
}

/**
 * Whether focus fell out of the page with the row that held it. Focus somebody put
 * elsewhere in the meantime is theirs, and is left alone.
 */
export function focusDropped(column: HTMLElement): boolean {
  const doc = column.ownerDocument;
  const active = doc.activeElement;
  return active === null || active === doc.body;
}

/** The due row's control for each control of a To buy row. */
const DUE_CONTROL: Readonly<Record<string, string>> = {
  '.step.minus': '.step.minus',
  '.step.plus': '.step.plus',
  [ROW_BUTTON]: '.body',
};

/**
 * Focus the same control of the line's due row, for a row that left To buy for the
 * due rows. False when that row or its control is not drawn (a due row past the
 * first few), so the caller falls back to {@link focusLeavingTarget}.
 */
export function focusDueRow(
  column: HTMLElement,
  lineId: string,
  target: LeavingRowFocus
): boolean {
  const row = Array.from(
    column.querySelectorAll<HTMLElement>('[data-due-line-id]')
  ).find((candidate) => candidate.dataset['dueLineId'] === lineId);
  const control = row?.querySelector<HTMLElement>(
    DUE_CONTROL[target.control] ?? DUE_CONTROL[ROW_BUTTON]
  );
  if (control === null || control === undefined) {
    return false;
  }
  control.focus();
  return true;
}

/** Focus what {@link focusAfterLeaving} chose, once the rows have redrawn. */
export function focusLeavingTarget(
  column: HTMLElement,
  target: LeavingRowFocus
): void {
  if (target.lineId !== null) {
    const row = Array.from(column.querySelectorAll<HTMLElement>(ROW)).find(
      (candidate) => candidate.dataset['lineId'] === target.lineId
    );
    const control =
      row?.querySelector<HTMLElement>(target.control) ??
      row?.querySelector<HTMLElement>(ROW_BUTTON);
    if (control !== null && control !== undefined) {
      control.focus();
      return;
    }
  }

  // No row left to go to: the heading of the page, made focusable for this.
  const heading =
    column.parentElement?.querySelector<HTMLElement>('lib-page-header h1');
  if (heading === null || heading === undefined) {
    return;
  }
  if (!heading.hasAttribute('tabindex')) {
    heading.setAttribute('tabindex', '-1');
  }
  heading.focus();
}
