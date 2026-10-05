/** What Tab can land on inside a container. */
const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keep Tab inside a sheet while it is open.
 *
 * A sheet covers the page behind a scrim, so the page is not there to be
 * tabbed into: without this a keyboard walks off the end of the sheet and onto
 * controls it cannot see. Called from the sheet's own `keydown`, it wraps Tab
 * from the last control to the first and Shift+Tab from the first to the last.
 * A container with nothing to tab to keeps the focus on itself.
 *
 * It handles Tab and nothing else. Escape is the opener's, because the opener
 * also knows where the focus goes back to.
 */
export function keepTabInside(
  event: KeyboardEvent,
  container: HTMLElement
): void {
  if (event.key !== 'Tab') {
    return;
  }

  const stops = [...container.querySelectorAll<HTMLElement>(TABBABLE)];
  const active = container.ownerDocument.activeElement;

  if (stops.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = stops[0];
  const last = stops[stops.length - 1];

  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  } else if (!container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}
