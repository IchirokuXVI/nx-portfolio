import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ProductIcon } from '@portfolio/velista/ui';

/** The product card, with every string already chosen in the reader's language. */
export interface SettleProductView {
  readonly name: string;
  /** `brand · size`, or whichever half exists, or null. */
  readonly detail: string | null;
  /** Null draws the carton glyph. */
  readonly imageUrl: string | null;
  /** The price the row underneath quotes, formatted, or null for none. */
  readonly price: string | null;
  /** Where that price is from: the chain, and the first shop when known. */
  readonly place: string | null;
}

/**
 * The product on the basket line sheet: its picture, its name over `brand · size`,
 * and the price the row underneath quotes.
 *
 * It follows the catalog's product row (velista `0100`, section 3), so a product
 * looks the same on the catalog tab and on the basket. The difference is that the
 * card is not a button: the only thing to do with it is to pick another of the
 * row's products, and that is the "Change" control, drawn only when the row has
 * more than one.
 */
@Component({
  selector: 'lib-settle-product',
  imports: [ProductIcon, RokuTranslatorPipe],
  template: `
    <div class="card">
      <span aria-hidden="true" class="image-box">
        @if (image(); as src) {
          <img
            (error)="broken.set(src)"
            [src]="src"
            alt=""
            class="image"
            decoding="async"
          />
        } @else {
          <lib-product-icon class="glyph" />
        }
      </span>

      <span class="what">
        <span class="name">{{ product().name }}</span>
        @if (product().detail; as detail) {
          <span class="detail">{{ detail }}</span>
        }
        @if (product().price; as price) {
          <span class="price">
            <span class="amount">{{ price }}</span>
            @if (product().place; as place) {
              <span class="place">{{ place }}</span>
            }
          </span>
        } @else {
          <span class="no-price">{{ 'basket.product.noPrice' | rokuT }}</span>
        }
      </span>

      @if (canChange()) {
        <button
          (click)="changeRequested.emit()"
          [disabled]="busy()"
          class="change"
          type="button"
        >
          {{ 'basket.product.change' | rokuT }}
        </button>
      }
    </div>
  `,
  styleUrl: './settle-product.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettleProduct {
  readonly product = input.required<SettleProductView>();

  /** Whether the row has other products to pick, which draws "Change". */
  readonly canChange = input(false);

  /** Whether a write on the row is out, so "Change" waits. */
  readonly busy = input(false);

  /** "Change" was pressed. */
  readonly changeRequested = output<void>();

  /** A picture that failed to load, so the carton takes its place. */
  protected readonly broken = signal<string | null>(null);

  protected readonly image = computed(() => {
    const src = this.product().imageUrl;
    return src !== null && src !== this.broken() ? src : null;
  });
}
