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
 * The question a raise of a zone list row asks when units bought above the ask were
 * counted toward it (velista `0207`), inside the anchored popover's `choice` frame
 * with its pointer on the row's amount control: two sentences as its title, then
 * "Still need" with the amount the person set and "Count the extra" with what is
 * left, or "That's enough" with no amount, each a row to the frame's edges.
 *
 * Focus starts on the second answer, the one that changes nothing, unless the page
 * says not to take it: a person still typing in a field keeps the field, and the
 * page says the question in its polite region instead. It owns no state: the page
 * decides what each answer does.
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
    <button (click)="stillNeed.emit()" class="answer" type="button">
      <span class="words">{{ words().stillNeed.words }}</span>
      <span class="amount">{{ words().stillNeed.amount }}</span>
    </button>
    <button (click)="kept.emit()" #keep class="answer" type="button">
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
   * Whether focus moves to the answer that changes nothing when it opens. False
   * while the person types in a field, so their keys stay in it.
   */
  readonly takeFocus = input(true);

  /** "Still need": the line goes to the amount the person set. */
  readonly stillNeed = output<void>();

  /** "Count the extra" or "That's enough": the smaller amount stands. */
  readonly kept = output<void>();

  /** The back gesture, which closes it as Escape does: the smaller amount stands. */
  readonly dismissed = output<void>();

  private readonly _keep =
    viewChild.required<ElementRef<HTMLButtonElement>>('keep');

  constructor() {
    afterNextRender(() => {
      if (this.takeFocus()) {
        this._keep().nativeElement.focus({ preventScroll: true });
      }
    });
    handleBackWhile(
      () => true,
      () => this.dismissed.emit()
    );
  }
}
