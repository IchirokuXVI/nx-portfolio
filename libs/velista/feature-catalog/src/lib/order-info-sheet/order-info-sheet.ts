import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { productPagePath, SheetNavigation } from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { coveredPageUrl } from '../row-adds';

/**
 * What the info button on the Similar products heading says (velista `0187`,
 * U6).
 *
 * Two orders meet a shopper. The product page sorts Similar products by the
 * price per kilo or litre, and a line marks as cheapest the product whose amount
 * costs least. The two can name different winners, so two short paragraphs say
 * why: one for each order, with the owner's own 300 g case as the example. It
 * names no chain and no price from the catalog, so it cannot go stale.
 *
 * A sheet and not a popover, for the line page's info button's reason (velista
 * `0137`): the same glyph in the same place behaves the same way, and the sheet
 * has a URL that survives a reload. Words only, so it holds no state.
 */
@Component({
  selector: 'lib-order-info-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  template: `
    <lib-sheet-shell (dismiss)="dismiss()" #shell labelledBy="order-info-title">
      <h2 class="title" id="order-info-title">
        {{ 'catalog.similar.about.title' | rokuT }}
      </h2>

      <p class="say">{{ 'catalog.similar.about.order' | rokuT }}</p>
      <p class="say">{{ 'catalog.similar.about.line' | rokuT }}</p>

      <button (click)="shell.requestDismiss()" class="close" type="button">
        {{ 'catalog.similar.about.close' | rokuT }}
      </button>
    </lib-sheet-shell>
  `,
  styleUrl: './order-info-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderInfoSheet {
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /**
   * Close, the scrim, Escape and the back button. The fallback is the product's
   * page this sheet covers, for a cold load of the sheet's own URL.
   */
  async dismiss(): Promise<void> {
    const itemId = this._route.snapshot.parent?.paramMap.get('itemId');
    await this._sheet.dismiss(
      itemId
        ? productPagePath(this._locale(), this._basePath, itemId)
        : coveredPageUrl(this._route.snapshot)
    );
  }
}
