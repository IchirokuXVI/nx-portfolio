/**
 * Where focus goes when a row it was in leaves the list (velista `0192`, section 4):
 * the same control of the next row, else of the previous row, else the list's
 * heading. The control is a stepper button when focus was on one, and the row's own
 * button otherwise.
 */
export interface EmptiedFocus {
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
export function focusAfterRemoval(
  column: HTMLElement,
  lineId: string
): EmptiedFocus | null {
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

/** Focus what {@link focusAfterRemoval} chose, once the rows have redrawn. */
export function focusEmptied(column: HTMLElement, target: EmptiedFocus): void {
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
