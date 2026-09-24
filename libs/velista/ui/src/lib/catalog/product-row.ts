import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ProductIcon } from '../icons/icons';

/** One product row, with every string already chosen in the reader's language. */
export interface ProductRowView {
  readonly id: string;
  readonly name: string;
  /** `brand · size`, or whichever half exists, or null. */
  readonly detail: string | null;
  /** Null draws the carton glyph. */
  readonly imageUrl: string | null;
  /** The price, formatted, or null for a row with none. */
  readonly price: string | null;
  /**
   * Under the price: the chain's name, or the price per litre or kilo while one
   * chain is chosen. Null draws the price alone.
   */
  readonly caption: string | null;
  /** The server judged the price old. Drawn muted, with no badge (section 3). */
  readonly stale: boolean;
  /** The accessible name: the product, the size and the price, in that order. */
  readonly label: string;
}

/**
 * One catalog product in the tab's list (velista `0100`, section 3).
 *
 * ## One button, and the name says everything
 *
 * The whole row opens the product sheet, so it is one control with one name
 * (section 7). The name is composed by the page, which has the translator and the
 * money helper: the product, the size and the price in that order, with `no price`
 * as words, so a screen reader hears what a sighted reader scans.
 *
 * ## The price is never colour alone
 *
 * A missing price is the words `no price`, never a dash. A stale one is drawn in
 * the muted colour and says nothing more, because the plan forbids a badge for it
 * and the sheet is where its age is told.
 */
@Component({
  selector: 'lib-product-row',
  imports: [ProductIcon, RokuTranslatorPipe],
  template: `
    <button
      (click)="opened.emit(row().id)"
      [attr.aria-label]="row().label"
      class="row"
      type="button"
    >
      <span aria-hidden="true" class="thumb">
        @if (image(); as src) {
          <img
            (error)="broken.set(src)"
            [src]="src"
            alt=""
            class="image"
            decoding="async"
            loading="lazy"
          />
        } @else {
          <lib-product-icon class="glyph" />
        }
      </span>

      <span class="what">
        <span class="name">{{ row().name }}</span>
        @if (row().detail; as detail) {
          <span class="detail">{{ detail }}</span>
        }
      </span>

      @if (row().price; as price) {
        <span [class.is-stale]="row().stale" class="price">
          <span class="amount">{{ price }}</span>
          @if (row().caption; as caption) {
            <span class="caption">{{ caption }}</span>
          }
        </span>
      } @else {
        <span class="no-price">{{ 'catalog.row.noPrice' | rokuT }}</span>
      }
    </button>
  `,
  styleUrl: './product-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductRow {
  readonly row = input.required<ProductRowView>();

  /** The product's id, when the row is pressed. */
  readonly opened = output<string>();

  /** A picture that failed to load, so the carton takes its place. */
  protected readonly broken = signal<string | null>(null);

  protected readonly image = computed(() => {
    const src = this.row().imageUrl;
    return src !== null && src !== this.broken() ? src : null;
  });
}

/**
 * A row's shape with nothing in it, for the first page and the next one
 * (section 4). The same box as a row, so nothing moves when the rows arrive.
 */
@Component({
  selector: 'lib-product-row-skeleton',
  template: `
    <span class="row skeleton">
      <span class="thumb bone"></span>
      <span class="what">
        <span class="bone line-long"></span>
        <span class="bone line-short"></span>
      </span>
      <span class="bone line-price"></span>
    </span>
  `,
  styleUrl: './product-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
})
export class ProductRowSkeleton {}
