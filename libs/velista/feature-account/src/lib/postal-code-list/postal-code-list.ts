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
  /**
   * Whether to bring in the codes near it (plan 0058, section 5).
   *
   * **Off by default here**, and on in the location sheet. Somebody typing one specific
   * code has usually named the place they mean; somebody who just handed over their
   * location has asked to be found.
   */
  readonly expandNearby: boolean;
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

  /**
   * How many derived codes the last add brought in, for the sentence about them.
   *
   * Zero says nothing worth mentioning happened, which is what a typed code with the
   * box unticked always produces (plan 0058, section 5).
   */
  readonly nearbyAdded = input(0);

  readonly addCode = output<NewPostalCode>();

  /**
   * Remove a code, **by the code and not by the row id**.
   *
   * The route takes the code, and it takes no argument saying how: whether the row is
   * deleted or suppressed follows from its own source, which the server knows. Emitting
   * the id would mean the page had to look the code back up to send it.
   */
  readonly removeCode = output<string>();

  /**
   * Somebody pressed "use my location".
   *
   * An output and not a navigation, because rule D1 keeps the router out of this
   * component. What it opens is a sheet, and the sheet exists so that what the press is
   * about to do is said before the browser's permission dialog appears: nothing here
   * touches geolocation, and nothing here could raise that dialog by accident.
   */
  readonly useLocation = output<void>();

  protected readonly maxLength = PROFILE_LIMITS.postalCodeMaxLength;
  protected readonly labelMaxLength = PROFILE_LIMITS.labelMaxLength;
  protected readonly maxCodes = PROFILE_LIMITS.maxPostalCodes;

  /** Whether the add form is showing. Closed until somebody asks for it. */
  protected readonly adding = signal(false);
  protected readonly typed = signal('');
  protected readonly typedLabel = signal('');

  /** Off for a typed code. The location sheet's copy of this control starts on. */
  protected readonly expandNearby = signal(false);

  /**
   * The cap the server enforces, checked here only to stop a request it would refuse.
   *
   * It counts the user's **own** codes and not the chips on screen, which is the
   * server's own rule (backend 0062): derived rows do not occupy the cap and could not,
   * because five codes each pulling in their neighbours is a set nobody sized. Counting
   * chips would hide the add control from somebody who had typed two codes.
   */
  protected readonly full = computed(
    () =>
      this.codes().filter((code) => code.source !== 'NEARBY').length >=
      this.maxCodes
  );

  protected isUncovered(postalCode: string): boolean {
    return this.uncovered().includes(postalCode);
  }

  /**
   * Whether this row is one the server concluded rather than one the user said.
   *
   * It decides a mark beside the chip and nothing else. A derived row is removed by
   * exactly the same control as any other, with the same weight: two rows that look
   * alike must not behave differently, and a quieter destructive path on the one the
   * user did not create would be the wrong way round anyway.
   */
  protected isDerived(code: ProfilePostalCode): boolean {
    return code.source === 'NEARBY';
  }

  /**
   * What the chip says under the code.
   *
   * **The code itself when there is no label** (plan 0058, section 4), rather than a
   * blank or a placeholder: `label` is nullable, every derived row has none, and the
   * code is what somebody recognises anyway.
   */
  protected nameOf(code: ProfilePostalCode): string {
    return code.label ?? code.postalCode;
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
    this.addCode.emit({
      postalCode,
      label: label === '' ? null : label,
      expandNearby: this.expandNearby(),
    });

    this._reset();
  }

  protected cancel(): void {
    this._reset();
  }

  protected toggleNearby(event: Event): void {
    this.expandNearby.set((event.target as HTMLInputElement).checked);
  }

  /**
   * Empty the form, including the checkbox.
   *
   * The tick does not persist to the next add. It is a decision about one code, and a
   * box left ticked from last time would widen a profile by a set the person did not
   * ask for on this one.
   */
  private _reset(): void {
    this.typed.set('');
    this.typedLabel.set('');
    this.expandNearby.set(false);
    this.adding.set(false);
  }
}
