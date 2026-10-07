import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { HoldingRow } from '@portfolio/velista/models';
import { PlusIcon, ProductIcon } from '../icons/icons';
import { QuantityStepper } from '../list/quantity-stepper';

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
   * chain is chosen. Under `no price` at one shop: that the shop has none
   * (velista `0124`). Null draws the price, or `no price`, alone.
   */
  readonly caption: string | null;
  /** The server judged the price old. Drawn muted, with no badge (section 3). */
  readonly stale: boolean;
  /** The accessible name: the product, the size and the price, in that order. */
  readonly label: string;
  /**
   * The detail with the price in it ("1 L · 1,09 € at Carrefour"), for the sheet
   * of what a visit added (velista `0134`, section 4.4). Null with neither a
   * detail nor a price.
   */
  readonly summary: string | null;
}

/**
 * The plus on a row (velista `0134`, section 4.1), or null for a row with none: a
 * guest, a person with no list to write to, and every row that is not offered for
 * adding.
 */
export interface ProductRowAdd {
  /** The chosen list's name, for the heading of the lines and the names of the controls. */
  readonly list: string;
  /**
   * The lines of the chosen list that hold this product, each with its own
   * quantity. Empty when the list does not hold it.
   */
  readonly lines: readonly HoldingRow[];
}

/** A press on the stepper of one line under a row. */
export interface ProductRowLineStep {
  readonly lineId: string;
  readonly by: 1 | -1;
}

/**
 * One catalog product in the tab's list (velista `0100`, section 3).
 *
 * ## One button for the product, and the name says everything
 *
 * The row opens the product, so that is one control with one name (section 7).
 * The name is composed by the page, which has the translator and the money
 * helper: the product, the size and the price in that order, with `no price` as
 * words, so a screen reader hears what a sighted reader scans.
 *
 * ## The plus is a sibling of that button, never a child (velista `0134`)
 *
 * A button in a button is not a control anybody can reach. So the card is the
 * host's own box, the product button fills it, and the plus sits after it.
 *
 * A press adds one, and the plus stays a plus.
 *
 * ## The lines that hold the product are under it, one stepper each
 *
 * A list can hold one product on several lines: once under the product's name and
 * again under a name somebody typed. One number on the plus could not say which
 * line it counted, so the row shows every line of the chosen list that holds the
 * product, with its name and its own stepper (the owner's decision after the walk
 * of stage 1). It is what the search of a list page shows under a product.
 *
 * ## The price is never colour alone
 *
 * A missing price is the words `no price`, never a dash. A stale one is drawn in
 * the muted colour and says nothing more, because the plan forbids a badge for it
 * and the sheet is where its age is told.
 */
@Component({
  selector: 'lib-product-row',
  imports: [PlusIcon, ProductIcon, QuantityStepper, RokuTranslatorPipe],
  template: `
    <div [class.has-add]="add() !== null" class="row">
      <button
        (click)="opened.emit(row().id)"
        [attr.aria-label]="
          verb() === null
            ? row().label
            : (verbLabel() ?? '' | rokuT: { label: row().label })
        "
        [disabled]="disabled()"
        class="open"
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
          <span class="no-price">
            <span class="no-price-word">{{
              'catalog.row.noPrice' | rokuT
            }}</span>
            @if (row().caption; as caption) {
              <span class="caption">{{ caption }}</span>
            }
          </span>
        }

        @if (verb(); as key) {
          <span aria-hidden="true" class="verb">{{ key | rokuT }}</span>
        }
      </button>

      @if (add(); as adding) {
        <button
          (click)="added.emit(row().id)"
          [attr.aria-label]="
            'catalog.add.label' | rokuT: { name: row().name, list: adding.list }
          "
          class="add"
          type="button"
        >
          <span class="add-dot"><lib-plus-icon /></span>
        </button>

        @if (adding.lines.length > 0) {
          <div class="held">
            <span class="held-title">{{
              'catalog.held.title' | rokuT: { list: adding.list }
            }}</span>
            <ul class="held-lines">
              @for (line of adding.lines; track line.lineId) {
                <li [attr.data-line]="line.lineId" class="held-line">
                  <span class="held-what">
                    <span class="held-name">{{ line.name }}</span>
                    @if (line.pending) {
                      <span class="held-pending">{{
                        'catalog.added.pending' | rokuT
                      }}</span>
                    }
                  </span>
                  <lib-quantity-stepper
                    (stepped)="
                      lineStepped.emit({ lineId: line.lineId, by: $event })
                    "
                    [accent]="line.quantity > 0"
                    [compact]="true"
                    [controlled]="true"
                    [disabled]="!line.editable"
                    [label]="
                      'catalog.held.stepper'
                        | rokuT: { line: line.name, list: adding.list }
                    "
                    [value]="line.quantity"
                  />
                </li>
              }
            </ul>
          </div>
        }
      }
    </div>
  `,
  styleUrl: './product-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductRow {
  readonly row = input.required<ProductRowView>();

  /**
   * What pressing the row does, as a translation key drawn as a pill at the
   * trailing edge ("Change"), or null for a row that opens the product.
   *
   * The row stays one button with one name: a second button inside it would be
   * a button in a button. {@link verbLabel} is that name, with `{{label}}`
   * standing for the row's own.
   */
  readonly verb = input<string | null>(null);
  readonly verbLabel = input<string | null>(null);

  /** While the row's action is in flight. */
  readonly disabled = input(false);

  /** The plus, or null for a row that offers none. See {@link ProductRowAdd}. */
  readonly add = input<ProductRowAdd | null>(null);

  /** The product's id, when the row is pressed. */
  readonly opened = output<string>();

  /** The plus was pressed: add one of this product. */
  readonly added = output<string>();

  /** A press on the stepper of one line that holds the product. */
  readonly lineStepped = output<ProductRowLineStep>();

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
