import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/**
 * How long this reader has on the basket they are looking at (velista `0094`,
 * section 5).
 *
 * ## Two moments, one component
 *
 * It is drawn once on arrival, dismissible, because somebody who came in on a
 * link never saw the screen that would have told them; and again half an hour
 * before the end, **not** dismissible, because that one is the last chance to
 * ask to be kept. The page decides which of the two is showing and whether it
 * is showing at all. This draws what it is handed.
 *
 * ## The sentence arrives finished
 *
 * One input, already translated, rather than a key and its arguments. Every
 * shape of this sentence interpolates a time, some of them a name as well, and
 * which of the four applies is a question about the reader that belongs to the
 * page. Passing a key here would mean passing the locale and the formatting
 * with it, into a component whose whole job is a line and a button.
 *
 * ## `role="status"`, announced once
 *
 * The wrapper is the live region and the copy sits inside it, so the sentence
 * is announced when it appears rather than on every redraw of the page around
 * it. Not `alert`: nothing has gone wrong, and the screen underneath is
 * working. The ended state is the one that takes `alert`, and it is a different
 * treatment on a different part of the page.
 *
 * ## No countdown
 *
 * It says a time, not a timer. A number ticking down on a screen somebody is
 * shopping from is a second thing to watch, and the one thing it would add is
 * pressure about a moment they cannot change from here.
 */
@Component({
  selector: 'lib-visit-notice',
  template: `
    <div class="notice" role="status">
      <p class="words">{{ text() }}</p>

      @if (dismissLabel(); as label) {
        <button (click)="dismissed.emit()" class="dismiss" type="button">
          {{ label }}
        </button>
      }
    </div>
  `,
  styleUrl: './visit-notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisitNotice {
  /** The whole sentence, already translated by the page. */
  readonly text = input.required<string>();

  /**
   * The dismiss control's label, or null for a notice that cannot be dismissed.
   *
   * The label doubles as the switch, rather than a second boolean input beside
   * it, because a dismissible notice with no word on its button is not a state
   * this has: the two always travel together.
   */
  readonly dismissLabel = input<string | null>(null);

  readonly dismissed = output<void>();
}
