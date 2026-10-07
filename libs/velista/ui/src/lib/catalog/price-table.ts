import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChainLogo, type ChainLogoView } from '../shops/chain-logo';

/** One chain's row, every string already chosen in the reader's language. */
export interface PriceTableRow {
  readonly supermarketId: string;
  readonly logo: ChainLogoView;
  readonly chain: string;
  /**
   * `priced` has a price, `unpriced` stocks it with no price anybody saw, and
   * `notSold` has no row at any of the person's shops.
   */
  readonly kind: 'priced' | 'unpriced' | 'notSold';
  /** The price, formatted, or null. */
  readonly price: string | null;
  /** The price per kilo or litre under it, or null when the source gave none. */
  readonly unitPrice: string | null;
  /** True on the one cheapest row. */
  readonly cheapest: boolean;
  /** The server judged the price old. Drawn muted, with no badge. */
  readonly stale: boolean;
}

/**
 * What each supermarket of the shopping profile charges for one product (velista
 * `0134`, section 5), cheapest first.
 *
 * It is the first thing on a product's page and it is on screen when the page
 * opens, because it is the answer to the question a person opened the page with.
 *
 * - The cheapest row says so in words, never by colour alone.
 * - A chain that does not sell the product says "not sold here" rather than
 *   drawing a dash, and a chain that stocks it with no price says "no price".
 *
 * The order is the caller's, from `productShopPrices`. This draws rows.
 */
@Component({
  selector: 'lib-price-table',
  imports: [ChainLogo, RokuTranslatorPipe],
  template: `
    <ul class="rows">
      @for (row of rows(); track row.supermarketId) {
        <li [class.is-absent]="row.kind === 'notSold'" class="row">
          <lib-chain-logo [logo]="row.logo" size="sm" />
          <span class="chain">{{ row.chain }}</span>
          @if (row.cheapest) {
            <span class="cheapest">{{
              'catalog.product.cheapest' | rokuT
            }}</span>
          }
          @switch (row.kind) {
            @case ('priced') {
              <span [class.is-stale]="row.stale" class="price">
                <span class="amount">{{ row.price }}</span>
                @if (row.unitPrice; as unit) {
                  <span class="unit">{{ unit }}</span>
                }
              </span>
            }
            @case ('unpriced') {
              <span class="absent">{{ 'catalog.row.noPrice' | rokuT }}</span>
            }
            @default {
              <span class="absent">{{
                'catalog.product.notSold' | rokuT
              }}</span>
            }
          }
        </li>
      }
    </ul>
  `,
  styleUrl: './price-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceTable {
  readonly rows = input.required<readonly PriceTableRow[]>();
}
