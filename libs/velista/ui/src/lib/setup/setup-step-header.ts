import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChevronLeftIcon } from '../icons/icons';

/**
 * The top of every setup step: back, Skip, the rail and the step's number
 * (velista `0098`, section 5).
 *
 * Presentational under rule D1. Both buttons are events, because where back goes and
 * what skipping writes are the step's decisions: the name step skips to the place, the
 * place step asks first, and the last step skips to the finish.
 *
 * **The rail is decorative** (section 9). It is hidden from assistive technology, and
 * the position is carried by the sentence below it, "Step 2 of 3", which is text a
 * screen reader reads in order with the heading that follows.
 */
@Component({
  selector: 'lib-setup-step-header',
  imports: [RokuTranslatorPipe, ChevronLeftIcon],
  template: `
    <div class="bar">
      <button
        (click)="back.emit()"
        [attr.aria-label]="'setup.back' | rokuT"
        class="back"
        type="button"
      >
        <lib-chevron-left-icon class="back-glyph" />
      </button>
      <button (click)="skip.emit()" class="skip" type="button">
        {{ 'setup.skip' | rokuT }}
      </button>
    </div>

    <div aria-hidden="true" class="rail">
      @for (reached of segments(); track $index) {
        <span [class.reached]="reached" class="segment"></span>
      }
    </div>

    <p class="step">
      {{ 'setup.step' | rokuT: { n: step(), total: total() } }}
    </p>
  `,
  styleUrl: './setup-step-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupStepHeader {
  /** Which step this is, counting from one. */
  readonly step = input.required<number>();

  /** How many steps there are. Three today, and the rail follows whatever it is. */
  readonly total = input(3);

  readonly back = output<void>();
  readonly skip = output<void>();

  /** One flag per segment: reached up to and including this step. */
  protected readonly segments = computed(() =>
    Array.from({ length: this.total() }, (_, index) => index < this.step())
  );
}
