import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';

/**
 * The panel a mutation is asked for in: scrim, rounded panel, grab handle, and the
 * modal behaviour that makes it a dialog rather than a box that happens to be on top.
 *
 * Rule E1 (plan 0008) makes each sheet a **child route** of the page it covers, so
 * this component never decides whether it is open: it exists when its route is
 * active and is destroyed when it is not. That is what makes the Android back button
 * close it, which is the behaviour the whole decision turns on. `dismiss` therefore
 * means "go back", and the container is the thing that knows where back is.
 *
 * ## What it owns, and why it is not four components
 *
 * Everything here is modal behaviour, and modal behaviour that is split up stops
 * working: a focus trap without a scrim traps focus behind something clickable, and a
 * scrim without a focus trap is a dialog a screen reader walks straight out of. The
 * body is projected, so the two sheets share all of it and share none of their copy.
 *
 * ## Semantics
 *
 * `role="dialog"`, `aria-modal="true"` and a label from the title the caller renders,
 * addressed by id. Focus moves inside on open and returns to the control that opened
 * it on close, which the browser does for free here: the sheet is a route, so closing
 * it restores the page beneath with its focus intact, and the explicit restore below
 * covers the case where it does not.
 *
 * ## Nothing browser-only at construction
 *
 * `afterNextRender` runs in the browser and never on the server (plan 0001, D2), and
 * the document is reached through the host element rather than through a global.
 */
@Component({
  selector: 'lib-sheet-shell',
  templateUrl: './sheet-shell.html',
  styleUrl: './sheet-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'requestDismiss()',
    // Plain `keydown` rather than `keydown.tab`, because Angular treats Shift+Tab as a
    // different binding (`keydown.shift.tab`) and the trap has to see both to know
    // which end it is at. The host binding hands over an `Event`, so it is narrowed
    // here rather than typed optimistically.
    '(keydown)': 'wrapFocus($event)',
  },
})
export class SheetShell {
  /** The id of the title the caller rendered, so the dialog is named by it. */
  readonly labelledBy = input.required<string>();

  /**
   * Whether the sheet may be closed right now.
   *
   * False while a mutation is in flight, which is the one state where dismissal is
   * genuinely wrong: the request has already gone, so closing would leave the person
   * unable to see what happened to a group that may well now exist (plan 0008,
   * section 3.1).
   */
  readonly dismissible = input(true);

  readonly dismiss = output<void>();

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Whatever had focus when the sheet opened, so it can be handed back. */
  private _returnFocusTo: HTMLElement | null = null;

  constructor() {
    afterNextRender(() => {
      const doc = this._host.nativeElement.ownerDocument;
      const active = doc.activeElement;
      this._returnFocusTo = active instanceof HTMLElement ? active : null;

      // The field, in practice: it is the first focusable thing the caller projects.
      // Focusing the panel itself instead would announce the dialog and then leave
      // the person a tab away from the only control that matters.
      this._focusable()[0]?.focus();
    });
  }

  /** Escape, and a tap on the scrim. Both are the same gesture as the back button. */
  requestDismiss(): void {
    if (this.dismissible()) {
      this._returnFocusTo?.focus();
      this.dismiss.emit();
    }
  }

  /**
   * Keeps Tab inside the sheet.
   *
   * Without this the next Tab lands on the front door behind the scrim, which is
   * visible, focusable and covered: the person is then typing into a page they cannot
   * see. `aria-modal` tells a screen reader the same thing, but it does nothing for a
   * keyboard, and the two have to agree.
   */
  wrapFocus(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Tab') {
      return;
    }

    const focusable = this._focusable();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }

    const doc = this._host.nativeElement.ownerDocument;
    const active = doc.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * The focusable elements inside the panel, in document order.
   *
   * Queried per use rather than cached, because the set changes as the sheet does: the
   * cancel row disappears while a request is in flight, and a rejected code adds
   * nothing focusable but could. A stale list would trap focus on a removed element.
   */
  private _focusable(): HTMLElement[] {
    const panel = this._host.nativeElement.querySelector('.panel');
    if (panel === null) {
      return [];
    }

    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }
}
