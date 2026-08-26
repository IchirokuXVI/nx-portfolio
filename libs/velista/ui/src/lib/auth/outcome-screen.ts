import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
} from '@angular/core';
import { BrandWordmark } from '../brand/brand-wordmark';
import { CheckIcon, ClockIcon } from '../icons/icons';

/** Which of the two things happened to the confirmation link. */
export type OutcomeTone = 'confirmed' | 'expired';

/**
 * What somebody sees after opening a confirmation link: the wordmark, a mark, a
 * heading, an explanation, whatever the caller projects, and one way onward.
 *
 * ## Why one component for both outcomes
 *
 * Expired, already used, and unknown are **one screen**, because the server returns one
 * error for all three and cannot tell them apart either (plan 0009, section 3.3).
 * Confirmed differs from them only in its mark, its tone and its words. Two components
 * would be the same layout twice, and the second copy is where the focus handling below
 * would quietly go missing.
 *
 * ## Why the heading takes focus
 *
 * The token is consumed on arrival, with nothing to press first, so by the time this
 * renders the outcome has already happened. Somebody using a screen reader arrived on a
 * page that was empty and then changed underneath them; moving focus to the heading is
 * what makes the result read out rather than leaving them on a page that appears blank
 * (section 7). `afterNextRender` runs in the browser and never on the server, per rule
 * D2, and the heading is reached through the host element rather than a global.
 */
@Component({
  selector: 'lib-outcome-screen',
  imports: [BrandWordmark, CheckIcon, ClockIcon],
  templateUrl: './outcome-screen.html',
  styleUrl: './outcome-screen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutcomeScreen {
  readonly tone = input.required<OutcomeTone>();
  readonly title = input.required<string>();
  readonly body = input.required<string>();

  /** The one action, which is always into the app. */
  readonly actionLabel = input.required<string>();

  readonly action = output<void>();

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      // `tabindex="-1"` on the heading is what makes this possible without putting it
      // in the tab order: it can be focused programmatically and never by tabbing.
      this._host.nativeElement.querySelector<HTMLElement>('.title')?.focus();
    });
  }
}
