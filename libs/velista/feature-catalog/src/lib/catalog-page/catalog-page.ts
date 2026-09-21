import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * The second tab, before it has a screen (velista `0097`, section 10).
 *
 * One line, no header, no furniture and no request. The tab ships with the bar, so
 * this route has to answer from the same day: a tab that leads to the app's 404 reads
 * as a broken app, and a tab that leads to a sentence reads as a screen that is coming.
 * Saying so is the whole job.
 *
 * `0100` replaces this component with the catalog itself, at this URL and in this
 * library. Nothing else should be added here in the meantime: anything built now would
 * be built without the read that plan is about.
 */
@Component({
  selector: 'lib-catalog-page',
  imports: [RokuTranslatorPipe],
  template: ` <p class="soon">{{ 'catalog.soon' | rokuT }}</p> `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      block-size: 100%;
      padding: var(--app-space-7);
    }

    .soon {
      color: var(--app-text-secondary);
      text-align: center;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {}
