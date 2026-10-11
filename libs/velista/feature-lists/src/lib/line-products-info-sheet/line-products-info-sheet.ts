import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { LineStore } from '@portfolio/velista/data-access';
import { SheetNavigation } from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { lineUrls } from '../line-page/line-urls';

/**
 * What the info button beside "Any of these will do" says (velista `0137`,
 * section 3).
 *
 * A line can hold several products and a shopper is shown one. Four sentences say
 * which: the favourite when the line has one, whatever it costs, and the cheapest
 * when it has none. The cards of the line page are in that same order, so the
 * first card is the answer.
 *
 * **It never says "basket".** The app calls that screen "Shopping list", in the
 * bar at the foot and in its own title, and a sheet that explained one word with
 * another nobody has seen would explain nothing.
 *
 * Words only, and nothing to write, so it holds no state of its own.
 */
@Component({
  selector: 'lib-line-products-info-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  template: `
    <lib-sheet-shell (dismiss)="dismiss()" labelledBy="line-products-info-title">
      <h2 class="title" id="line-products-info-title">
        {{ 'list.page.about.title' | rokuT }}
      </h2>

      <p class="say">
        {{ 'list.page.about.any' | rokuT: { line: lineName() } }}
      </p>
      <p class="say">{{ 'list.page.about.favorite' | rokuT }}</p>
      <p class="say">{{ 'list.page.about.cheapest' | rokuT }}</p>
      <p class="say">{{ 'list.page.about.order' | rokuT }}</p>

      <button (click)="dismiss()" class="secondary" type="button">
        {{ 'list.page.about.close' | rokuT }}
      </button>
    </lib-sheet-shell>
  `,
  styleUrl: './line-products-info-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineProductsInfoSheet {
  private readonly _lines = inject(LineStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _urls = lineUrls();

  /** The line the sentences are about, or nothing while it has not arrived. */
  readonly lineName = computed(
    () =>
      this._lines
        .linesIn(this._urls.listId())
        .find((line) => line.id === this._urls.lineId())?.content ?? ''
  );

  /** Close, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(this._urls.line());
  }
}
