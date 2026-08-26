import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * The loading state.
 *
 * **Loading is not a spinner** (plan 0003, section 3). The user opens this in a shop,
 * and a skeleton that matches the final layout keeps the page from jumping when the
 * data lands. A centred spinner tells them nothing and then rearranges the screen
 * underneath their thumb.
 *
 * The shapes deliberately match a zone card's header: a tile, a name, and a line of
 * counts. Matching approximately would be worse than not matching at all, because the
 * jump is what the skeleton exists to prevent.
 */
@Component({
  selector: 'lib-zone-skeleton',
  imports: [RokuTranslatorPipe],
  template: `
    <div
      [attr.aria-label]="'home.loading' | rokuT"
      class="wrapper"
      role="status"
    >
      @for (card of placeholders(); track $index) {
        <div aria-hidden="true" class="card">
          <div class="row">
            <span class="tile"></span>
            <span class="lines">
              <span class="line line-name"></span>
              <span class="line line-meta"></span>
            </span>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './zone-skeleton.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneSkeleton {
  readonly count = input(2);

  /** `@for` needs something to iterate; the values are never read. */
  readonly placeholders = () => Array.from({ length: this.count() });
}
