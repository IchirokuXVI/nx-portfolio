import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * Rows that have not arrived yet, for the group page's lists and the members screen.
 *
 * **Loading is not a spinner** (plan 0003, section 3), and here it matters more than on
 * the dashboard: the group page usually draws its header from the cache the instant it
 * opens, so only the rows below are missing. A centred spinner would replace a screen
 * that is already half correct.
 *
 * Distinct from `ZoneSkeleton`, which is card shaped. Matching approximately would be
 * worse than not matching at all, since the jump is the thing a skeleton exists to
 * prevent.
 */
@Component({
  selector: 'lib-row-skeleton',
  imports: [RokuTranslatorPipe],
  template: `
    <div [attr.aria-label]="labelKey() | rokuT" class="wrapper" role="status">
      @for (row of placeholders(); track $index) {
        <div aria-hidden="true" class="row">
          <span class="avatar"></span>
          <span class="lines">
            <span class="line line-name"></span>
            <span class="line line-meta"></span>
          </span>
        </div>
      }
    </div>
  `,
  styleUrl: './row-skeleton.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowSkeleton {
  readonly count = input(3);

  /** What a screen reader is told is loading. The caller's screen names its own. */
  readonly labelKey = input('zone.detail.loading');

  /** `@for` needs something to iterate; the values are never read. */
  readonly placeholders = () => Array.from({ length: this.count() });
}
