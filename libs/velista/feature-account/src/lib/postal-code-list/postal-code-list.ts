import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  PROFILE_LIMITS,
  type ProfilePostalCode,
} from '@portfolio/velista/models';
import { CloseIcon, PlusIcon } from '@portfolio/velista/ui';

/** One postal code, as this component is asked to add it. */
export interface NewPostalCode {
  readonly postalCode: string;
  readonly label: string | null;
}

/**
 * Where somebody shops from, as chips (plan 0046, section 4).
 *
 * ## An uncovered code is kept, flagged, and explained in words
 *
 * `uncovered` names the codes the catalog says nobody we know serves. It is a **flag
 * under the chip and never a rejection**: coverage is a property of our data rather than
 * of the user's address, and refusing the code would tell somebody they live nowhere.
 * The sentence sits in a polite live region, because the flag arrives from a request
 * that finishes after the chip is already on screen and nothing else would announce it
 * (section 7).
 *
 * ## The form is a real form
 *
 * Which is what makes enter submit with no key handler of this component's own, and what
 * makes the phone keyboard offer Go. The label field beside the code is optional in the
 * sense the server means: absent is a chip with no label, not a chip labelled "".
 *
 * Rule D1 holds: no store, no service, no router.
 */
@Component({
  selector: 'lib-postal-code-list',
  imports: [RokuTranslatorPipe, CloseIcon, PlusIcon],
  templateUrl: './postal-code-list.html',
  styleUrl: './postal-code-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PostalCodeList {
  readonly codes = input.required<readonly ProfilePostalCode[]>();

  /** The codes nobody we know serves, as the codes themselves. */
  readonly uncovered = input<readonly string[]>([]);

  /** Whether the last write to this control failed, for the failed treatment. */
  readonly failed = input(false);

  readonly addCode = output<NewPostalCode>();
  readonly removeCode = output<string>();

  protected readonly maxLength = PROFILE_LIMITS.postalCodeMaxLength;
  protected readonly labelMaxLength = PROFILE_LIMITS.labelMaxLength;
  protected readonly maxCodes = PROFILE_LIMITS.maxPostalCodes;

  /** Whether the add form is showing. Closed until somebody asks for it. */
  protected readonly adding = signal(false);
  protected readonly typed = signal('');
  protected readonly typedLabel = signal('');

  /** The cap the server enforces, checked here only to stop a request it would refuse. */
  protected readonly full = computed(
    () => this.codes().length >= this.maxCodes
  );

  protected isUncovered(postalCode: string): boolean {
    return this.uncovered().includes(postalCode);
  }

  protected open(): void {
    this.adding.set(true);
  }

  protected onTyped(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  protected onLabelTyped(event: Event): void {
    this.typedLabel.set((event.target as HTMLInputElement).value);
  }

  /**
   * Submit the add.
   *
   * The form closes on the way out rather than after the save answers, because the save
   * is optimistic: the chip is already there, and a form left open over it would look
   * like the code had not been taken.
   */
  protected submit(event: Event): void {
    event.preventDefault();

    const postalCode = this.typed().trim();
    if (postalCode === '' || this.full()) {
      return;
    }

    const label = this.typedLabel().trim();
    this.addCode.emit({ postalCode, label: label === '' ? null : label });

    this.typed.set('');
    this.typedLabel.set('');
    this.adding.set(false);
  }

  protected cancel(): void {
    this.typed.set('');
    this.typedLabel.set('');
    this.adding.set(false);
  }
}
