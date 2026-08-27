import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { SheetShell } from '../entry/sheet-shell';
import { SpinnerIcon } from '../icons/icons';

/**
 * One decision about something on screen: a title, a sentence, and two answers.
 *
 * ## Why a confirm at all, and why only for four of them
 *
 * Reversibility decides it, not severity of tone (plan 0010, section 5.7). Approve and
 * reject get none, because they are common and a rejected person can ask again. Kick,
 * ban, regenerate and transfer get one, because each takes something away from
 * somebody that they cannot get back on their own.
 *
 * ## The typed name
 *
 * Delete gets a confirm **and** the group's name typed in, and it is the only thing in
 * this app that does. An ordinary destructive confirm is a two tap gesture that a
 * phone in a pocket or a misread row can complete, and what this one destroys belongs
 * to other people as much as to the person pressing it: every list, line and comment
 * for every member, with no undo anywhere in the product.
 *
 * It is a mode on this component rather than a sheet of its own, so that **nothing
 * else grows one by imitation**: adding friction is a decision, and it should have to
 * be made explicitly by passing `confirmWith`.
 *
 * The comparison trims and case folds. It is deliberate friction, not a spelling test
 * (section 7).
 */
@Component({
  selector: 'lib-confirm-sheet',
  imports: [RokuTranslatorPipe, SheetShell, SpinnerIcon],
  templateUrl: './confirm-sheet.html',
  styleUrl: './confirm-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmSheet {
  readonly titleId = input.required<string>();
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  /** The label on the button that goes ahead. Always a verb, never "OK". */
  readonly confirmLabel = input.required<string>();

  /** Whether the primary is styled as destructive. Colour is never the only signal. */
  readonly destructive = input(false);

  /**
   * The exact text that must be typed before the primary enables, or null for an
   * ordinary confirm. Only delete passes this. See the class comment.
   */
  readonly confirmWith = input<string | null>(null);

  /** The prompt above the typed field. Only read when `confirmWith` is set. */
  readonly confirmWithLabel = input<string>('');

  /**
   * The **key** of a message under the body when the write failed, or null.
   *
   * A key rather than a resolved string, so the caller picks the sentence its own
   * operation deserves (section 5.6) and nothing here ever renders the server's
   * `message`, which is one line per code and unusable as copy.
   */
  readonly errorKey = input<string | null>(null);

  readonly busy = input(false);

  readonly confirm = output<void>();
  readonly dismiss = output<void>();

  readonly typed = signal('');

  /**
   * Whether the primary is enabled.
   *
   * A sheet with no `confirmWith` is enabled unless a request is out. One with it is
   * enabled only on an exact match, trimmed and case folded, which is the whole
   * mechanism: the person has to have read the name.
   */
  readonly canConfirm = computed(() => {
    if (this.busy()) {
      return false;
    }

    const expected = this.confirmWith();
    return expected === null || fold(this.typed()) === fold(expected);
  });

  onTyped(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
  }

  submit(): void {
    if (this.canConfirm()) {
      this.confirm.emit();
    }
  }
}

/**
 * Trim and case fold, so the check is friction rather than a spelling test.
 *
 * `toLocaleLowerCase` and not `toLowerCase`, because the group being deleted may well
 * be named in Turkish, where the two disagree about the letter I and the difference is
 * a button that never enables.
 */
function fold(value: string): string {
  return value.trim().toLocaleLowerCase();
}
