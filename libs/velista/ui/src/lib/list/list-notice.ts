import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * One quiet line at the top of the list.
 *
 * Its only job today is section 3.2's reader notice, and the rule that shapes it is
 * **once**: a reader tapping a row gets this the first time and silence afterwards.
 * The tick gesture is the whole interaction model of this screen, so a reader tapping
 * and getting nothing at all would read as a broken app; the same sentence appearing
 * on every subsequent tap would read as nagging.
 *
 * Not a toast, and not a dialog. It stays where it was put, it interrupts nothing, and
 * the person can carry on reading the list they came to read.
 */
@Component({
  selector: 'lib-list-notice',
  imports: [RokuTranslatorPipe],
  template: `
    <p aria-live="polite" class="notice">{{ messageKey() | rokuT }}</p>
  `,
  styleUrl: './list-notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListNotice {
  readonly messageKey = input.required<string>();
}
