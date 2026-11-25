import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { handleBackWhile } from '@portfolio/velista/platform';
import type { ExtraAskWords } from './extra-ask-words';

let askCount = 0;

/**
 * The question a raise asks when it took units bought above the ask into the ask
 * (velista `0207`, `0208`), inside the anchored popover's `choice` frame with its
 * pointer on the amount control: two sentences as its title, then "Still need" with
 * the amount the control shows and "Count the extra" with the smaller amount, or
 * "That's enough" with no amount, each a row to the frame's edges.
 *
 * Focus starts on "Still need", the answer that changes nothing (the owner,
 * 2026-11-22; velista `0208`, target state 5), unless the page says not to take
 * it: a person still typing in a field keeps the field, and the page says the
 * question in its polite region instead. It owns no state: the page decides what
 * each answer does.
 *
 * The popover is inserted in the list item beside the row, never inside the row,
 * whose press opens the line. A press in here still stops at this element, so
 * nothing around it hears it as a press on the list.
 */
@Component({
  selector: 'lib-extra-ask',
  host: {
    '(click)': '$event.stopPropagation()',
    '(pointerdown)': '$event.stopPropagation()',
  },
  template: `
    <p [id]="titleId()" class="question">{{ words().question }}</p>
    <button (click)="stillNeed.emit()" #still class="answer" type="button">
      <span class="words">{{ words().stillNeed.words }}</span>
      <span class="amount">{{ words().stillNeed.amount }}</span>
    </button>
    <button (click)="kept.emit()" class="answer" type="button">
      <span class="words">{{ words().keep.words }}</span>
      @if (words().keep.amount; as amount) {
        <span class="amount">{{ amount }}</span>
      }
    </button>
  `,
  styleUrl: './extra-ask.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtraAsk {
  /** What it says, from `extraAskWords`. */
  readonly words = input.required<ExtraAskWords>();

  /** The question's id, for the dialog around it to be labelled by. */
  readonly titleId = input(`extra-ask-title-${++askCount}`);

  /**
   * Whether focus moves to "Still need", the answer that changes nothing, when it
   * opens. False while the person types in a field, so their keys stay in it.
   */
  readonly takeFocus = input(true);

  /** "Still need": the amount the control shows stands, and nothing is sent. */
  readonly stillNeed = output<void>();

  /** "Count the extra" or "That's enough": the page counts, and the smaller amount stands. */
  readonly kept = output<void>();

  /** The back gesture, which closes it as Escape does: no answer, nothing sent. */
  readonly dismissed = output<void>();

  private readonly _still =
    viewChild.required<ElementRef<HTMLButtonElement>>('still');

  constructor() {
    afterNextRender(() => {
      if (this.takeFocus()) {
        this._still().nativeElement.focus({ preventScroll: true });
      }
    });
    handleBackWhile(
      () => true,
      () => this.dismissed.emit()
    );
  }
}
