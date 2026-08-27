import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  LINE_CONTENT_COUNTER_FROM,
  LINE_CONTENT_MAX_LENGTH,
} from '@portfolio/velista/models';
import { PlusIcon } from '../icons/icons';
import { QuantityStepper } from './quantity-stepper';

/**
 * The field at the bottom of the list, and the reason this screen has no floating
 * action button.
 *
 * ## Adding happens in runs
 *
 * Somebody stands in the kitchen and enters six things. So the field **keeps focus
 * across a submit**, the keyboard never comes down between two adds, and the quantity
 * resets to one so the seventh item does not silently inherit the sixth one's count.
 * A FAB would put a dialog between every pair of those six.
 *
 * ## It is absent for a reader, never disabled
 *
 * That decision belongs to the container, which knows whether the caller may write.
 * This component is simply not rendered in that case, because a disabled text field at
 * the bottom of a screen is an invitation that does not work and costs a tap to find
 * out (section 3.2).
 *
 * ## The counter appears late
 *
 * Only past 350 of 400 characters. A running count under a field somebody is typing a
 * shopping item into is noise for every realistic entry, and the cap exists to stop an
 * accident rather than to be aimed at.
 */
@Component({
  selector: 'lib-line-composer',
  imports: [RokuTranslatorPipe, PlusIcon, QuantityStepper],
  templateUrl: './line-composer.html',
  styleUrl: './line-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineComposer {
  /** Whether a submit is in flight. The field stays usable; only the button waits. */
  readonly busy = input(false);

  /**
   * Whether to take focus on creation.
   *
   * True on an empty list, where there is exactly one thing to do and the composer is
   * already focused (section 3.1), and false otherwise, because stealing focus and
   * raising a keyboard over a list somebody opened to read would be hostile.
   *
   * Focused **programmatically** rather than through the `autofocus` attribute, which
   * `@angular-eslint` forbids and is right to: the attribute fires on page load with no
   * regard for what the person was doing, and there is no way to withdraw it. Doing it
   * here means the one condition that justifies it is written down and testable.
   */
  readonly takeFocus = input(false);

  readonly submitted = output<{ content: string; quantity: number }>();

  readonly content = signal('');
  readonly quantity = signal(1);

  readonly maxLength = LINE_CONTENT_MAX_LENGTH;
  readonly counterFrom = LINE_CONTENT_COUNTER_FROM;

  readonly showCounter = computed(
    () => this.content().length >= this.counterFrom
  );

  readonly canSubmit = computed(() => this.content().trim() !== '');

  private readonly _field = viewChild<ElementRef<HTMLInputElement>>('field');

  constructor() {
    // `afterNextRender` runs in the browser and never on the server (plan 0001, D2),
    // which is also why this cannot be an attribute: the attribute would be in the
    // server rendered HTML and would fire on hydration.
    afterNextRender(() => {
      if (this.takeFocus()) {
        this._field()?.nativeElement.focus();
      }
    });
  }

  onInput(event: Event): void {
    this.content.set((event.target as HTMLInputElement).value);
  }

  /**
   * Send it, and stay ready for the next one.
   *
   * The field is cleared and the quantity reset **here**, before the request resolves,
   * because the add is optimistic and the row is already on screen: leaving the text in
   * the field until a response arrived would show the same item twice and invite a
   * second submit of it.
   *
   * Focus is taken back explicitly. Clearing an input does not move focus, but the
   * button that was tapped has it, and on a phone that is enough to drop the keyboard.
   */
  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.submitted.emit({
      content: this.content().trim(),
      quantity: this.quantity(),
    });

    this.content.set('');
    this.quantity.set(1);
    this._field()?.nativeElement.focus();
  }
}
