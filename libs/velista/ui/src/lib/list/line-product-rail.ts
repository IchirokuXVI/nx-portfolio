import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { LineProductCardVm } from '@portfolio/velista/models';
import { StarFilledIcon, StarIcon } from '../icons/icons';
import { ProductPicture } from './product-picture';

/**
 * The products of a line, as cards that scroll sideways (velista `0135`,
 * section 3).
 *
 * A product on the line page was a chip with a name. A card says what tells two
 * products apart at a shelf: the picture, the size and the brand, the price, and
 * where that price is.
 *
 * ## Two buttons in a card, side by side
 *
 * The card opens the product, and the star makes it the favourite (section 3.1).
 * They are siblings, because a button inside a button is not valid and a screen
 * reader would hear one control. The star sits over the corner of the picture.
 *
 * ## The star is a mark for a reader who may not edit
 *
 * With `canFavorite` false the favourite keeps its filled star, as text for a
 * screen reader and not as a control, and the other cards have none. A star that
 * cannot be pressed is not drawn as something to press.
 *
 * Plain values in, events out (rule D1): the page owns the line and the write.
 */
@Component({
  selector: 'lib-line-product-rail',
  imports: [RokuTranslatorPipe, ProductPicture, StarIcon, StarFilledIcon],
  template: `
    <ul (scroll)="onScroll($event)" class="rail">
      @for (card of cards(); track card.itemId) {
        <li class="card">
          <button (click)="opened.emit(card.itemId)" class="open" type="button">
            <lib-product-picture [imageUrl]="card.imageUrl" class="picture" />

            <span class="name">{{
              card.name ?? ('list.detail.unnamedProduct' | rokuT)
            }}</span>

            @if (card.detail; as detail) {
              <span class="detail">{{ detail }}</span>
            }

            @switch (card.priceKind) {
              @case ('priced') {
                <span class="price">{{ card.price }}</span>
              }
              @case ('loading') {
                <span aria-hidden="true" class="price bone"></span>
              }
              @case ('notSold') {
                <span class="no-price">{{
                  'list.page.card.notSold'
                    | rokuT: { supermarket: supermarket() ?? '' }
                }}</span>
              }
              @default {
                <span class="no-price">{{
                  'list.page.card.noPrice' | rokuT
                }}</span>
              }
            }

            @if (card.caption; as caption) {
              <span class="caption">{{ caption }}</span>
            }

            @if (card.cheapest) {
              <span class="word">{{ 'list.page.card.cheapest' | rokuT }}</span>
            }
          </button>

          @if (canFavorite()) {
            <button
              (click)="favorited.emit(card.itemId)"
              [attr.aria-label]="
                (card.favorite
                  ? 'list.page.card.favoriteOn'
                  : 'list.page.card.favoriteOff'
                ) | rokuT: { name: card.name ?? '' }
              "
              [attr.aria-pressed]="card.favorite"
              [class.is-on]="card.favorite"
              [disabled]="busy()"
              class="star"
              type="button"
            >
              @if (card.favorite) {
                <lib-star-filled-icon />
              } @else {
                <lib-star-icon />
              }
            </button>
          } @else if (card.favorite) {
            <span class="star is-on is-mark">
              <lib-star-filled-icon />
              <span class="visually-hidden">{{
                'list.page.card.favorite' | rokuT
              }}</span>
            </span>
          }
        </li>
      }
    </ul>
  `,
  styleUrl: './line-product-rail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineProductRail {
  readonly cards = input.required<readonly LineProductCardVm[]>();

  /** Whether the stars are buttons. False for a reader who may not edit the line. */
  readonly canFavorite = input(false);

  /** A write is out, so the stars wait. The cards still open. */
  readonly busy = input(false);

  /**
   * The supermarket of the line, already in the reader's language, for a card
   * that says "not at Mercadona". Null with none chosen.
   */
  readonly supermarket = input<string | null>(null);

  /** A card was pressed: its product. */
  readonly opened = output<string>();

  /** A star was pressed: its product. The page decides to set or to clear. */
  readonly favorited = output<string>();

  /**
   * How many cards the row has reached, counted from the first, as it scrolls. The
   * page reads the prices of the cards on screen and a few past them, and not of a
   * hundred products nobody scrolled to.
   */
  readonly reached = output<number>();

  protected onScroll(event: Event): void {
    const rail = event.currentTarget as HTMLElement;
    const first = rail.firstElementChild as HTMLElement | null;
    if (first === null) {
      return;
    }
    // One card and the gap after it, measured off the row itself.
    const second = first.nextElementSibling as HTMLElement | null;
    const step =
      second === null
        ? first.offsetWidth
        : second.offsetLeft - first.offsetLeft;
    if (step > 0) {
      this.reached.emit(Math.ceil((rail.scrollLeft + rail.clientWidth) / step));
    }
  }
}
