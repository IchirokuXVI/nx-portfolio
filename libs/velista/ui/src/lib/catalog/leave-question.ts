import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * "Leave without saving?" (velista `0146`, section 4): a card in the middle of a
 * dimmed screen, over the catalog that chooses the products of a line, when it is
 * left with a change in the set.
 *
 * **Not a sheet.** A sheet is a route, and the question is asked from inside a
 * navigation that is already going: the back of the browser. A guard holds that
 * navigation while the card is up and lets it through on Leave, so the card has
 * to be part of the page, as the walk editor's "Not saved yet" is.
 *
 * The safe answer is the first one and has the focus, so Enter and Escape both
 * keep the person on the page. Tab goes round the two answers and never reaches
 * the page behind, which the page makes `inert` while the card is up: the
 * keyboard's half of what `aria-modal` says to a screen reader, as the sheets
 * and the tour card do. Every string arrives translated.
 */
@Component({
  selector: 'lib-leave-question',
  template: `
    <div aria-hidden="true" class="scrim"></div>
    <div
      aria-labelledby="leave-question-title"
      aria-modal="true"
      class="card"
      role="alertdialog"
    >
      <h2 class="title" id="leave-question-title">{{ question() }}</h2>
      <button (click)="stay.emit()" #keep class="keep" type="button">
        {{ stayLabel() }}
      </button>
      <button (click)="leave.emit()" #leaveButton class="leave" type="button">
        {{ leaveLabel() }}
      </button>
    </div>
  `,
  styleUrl: './leave-question.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': '$event.stopPropagation(); stay.emit()',
    // Plain `keydown`: Angular's `keydown.tab` does not match Shift+Tab.
    '(keydown)': 'wrapFocus($event)',
  },
})
export class LeaveQuestion {
  /** "Leave without saving?" */
  readonly question = input.required<string>();
  /** "Keep choosing" */
  readonly stayLabel = input.required<string>();
  /** "Leave" */
  readonly leaveLabel = input.required<string>();

  /** Stay on the page, with the set as it is. */
  readonly stay = output<void>();

  /** Leave the page without saving. */
  readonly leave = output<void>();

  private readonly _keep = viewChild<ElementRef<HTMLButtonElement>>('keep');
  private readonly _leave =
    viewChild<ElementRef<HTMLButtonElement>>('leaveButton');

  constructor() {
    // The control that asked (the close, a card), so the focus goes back to it
    // when the card goes and the person keeps choosing.
    const asker = inject(DOCUMENT).activeElement;
    afterNextRender(() => this._keep()?.nativeElement.focus());
    inject(DestroyRef).onDestroy(() => {
      if (asker instanceof HTMLElement && asker.isConnected) {
        asker.focus();
      }
    });
  }

  /** Tab from the last answer goes to the first, and Shift Tab the other way. */
  protected wrapFocus(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Tab') {
      return;
    }
    const first = this._keep()?.nativeElement;
    const last = this._leave()?.nativeElement;
    if (first === undefined || last === undefined) {
      return;
    }
    const active = first.ownerDocument.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (active !== first && active !== last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
}
