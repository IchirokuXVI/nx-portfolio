import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  BasketIcon,
  ChevronDownIcon,
  ClockIcon,
  PlusIcon,
} from '../icons/icons';
import { ProductPicture } from '../list/product-picture';
import { QuantityStepper } from '../list/quantity-stepper';

/** One chain's mark on the chain line: its initial, in the app's own colours. */
export interface ProductRowChainMark {
  readonly id: string;
  readonly initial: string;
}

/** The chain line: who sells the product, the cheapest named first. */
export interface ProductRowChains {
  /** The cheapest chain's name, the only one written out. */
  readonly lead: string;
  /** At most `CHAIN_MARKS_SHOWN` marks, the lead's first. */
  readonly marks: readonly ProductRowChainMark[];
  /** How many chains the marks leave out, drawn as `+2`, or zero. */
  readonly more: number;
  /** "Sold at Mercadona. Show every shop price", for the line drawn as a button. */
  readonly label: string;
}

/** One card, with every string already chosen in the reader's language. */
export interface ProductRowView {
  readonly id: string;
  readonly name: string;
  /** `brand · size · pack`, or whichever parts exist, or null. */
  readonly detail: string | null;
  /**
   * A short line under the detail that the host words ("Chosen now", "Waiting for
   * approval"), or null.
   */
  readonly caption: string | null;
  /** Null draws the product glyph. */
  readonly imageUrl: string | null;
  /** The price, formatted, or null for a card with none. */
  readonly price: string | null;
  /**
   * Under the price: the price per litre or kilo when it differs from the price,
   * or null.
   */
  readonly unitPrice: string | null;
  /** Under a stale price, how long ago it was seen ("18 days ago"), or null. */
  readonly seen: string | null;
  /** The server judged the price old. Drawn muted, with its age and the clock. */
  readonly stale: boolean;
  /** The chains that sell it, or null when none can be named. */
  readonly chains: ProductRowChains | null;
  /** The accessible name: the product, the size and the price, in that order. */
  readonly label: string;
  /**
   * The detail with the price in it ("1 L · 1,09 € at Carrefour"), for the sheet
   * of what a visit added (velista `0134`, section 4.4). Null with neither a
   * detail nor a price.
   */
  readonly summary: string | null;
}

/** One line under a card that holds its product, with its own stepper. */
export interface ProductRowHeldLine {
  readonly lineId: string;
  /** The line's own words, so a renamed line says what it was renamed to. */
  readonly name: string;
  readonly quantity: number;
  /** Whether the person may move its quantity. */
  readonly editable: boolean;
  /** The line waits for an owner's approval. */
  readonly pending: boolean;
  /**
   * The list the line is on, drawn above its words, or absent. Only where the
   * lines come from several lists (the shopping list's search).
   */
  readonly list?: string | null;
  /** The stepper's name, when the host words it. Absent: "How many of X in L". */
  readonly stepperLabel?: string;
}

/**
 * The plus on a card (velista `0134`, section 4.1), and the lines under it, or null
 * for a card with none: a guest, a person with no list to write to, and every card
 * that is not offered for adding.
 */
export interface ProductRowAdd {
  /** The list it adds to, for the heading of the lines and the names of the controls. */
  readonly list: string;
  /**
   * The lines that hold this product, each with its own quantity. Empty when the
   * list does not hold it.
   */
  readonly lines: readonly ProductRowHeldLine[];
  /** The plus's name, when the host words it. Absent: "Add X to L". */
  readonly label?: string;
  /** The heading over the lines, when the host words it. Absent: "On L". */
  readonly title?: string;
}

/**
 * The radio of a card in the catalog that chooses one product (velista `0140`,
 * section 3), or its tick in the catalog that chooses the products of a line
 * (velista `0146`, section 3).
 */
export interface ProductRowChoice {
  /** The group the radios of one list share. */
  readonly name: string;
  readonly checked: boolean;
  /** A tick, of a set, in place of the radio. Absent is a radio. */
  readonly multiple?: boolean;
}

/** A stepper in the control slot, for a compact card in a sheet (velista `0163`). */
export interface ProductRowStepper {
  readonly value: number;
  /** Its accessible name, naming the product. */
  readonly label: string;
  /** The lowest it goes. Absent is the stepper's own floor. */
  readonly min?: number;
  readonly disabled?: boolean;
}

/** One chain's price under an opened chain line (the search). */
export interface ProductRowShop {
  readonly id: string;
  readonly name: string;
  /** Null for a chain that carries the product with no price on it. */
  readonly price: string | null;
  /** "seen 12 days ago" when the server marked this price stale, else null. */
  readonly note: string | null;
  /** The cheapest, which carries the number at the top of the card. */
  readonly best: boolean;
}

/** One product inside an opened group. */
export interface ProductRowMember {
  readonly id: string;
  readonly name: string;
  readonly brand: string | null;
  readonly price: string | null;
}

/**
 * A card that draws a product group rather than a product (the search): the crate
 * in place of the picture, the word "Group" after the name, and its cheapest
 * products under it once opened.
 */
export interface ProductRowGroup {
  /** The cheapest five, at most. */
  readonly members: readonly ProductRowMember[];
  /** "6 products", the reveal's own words, or null with no members to reveal. */
  readonly reveal: string | null;
  /** "and 1 more" under the five, or null when the five are all of them. */
  readonly more: string | null;
}

/** A press on the stepper of one line under a card. */
export interface ProductRowLineStep {
  readonly lineId: string;
  readonly by: 1 | -1;
}

/** The plus was pressed, and the button that was pressed. */
export interface ProductRowAdded {
  readonly id: string;
  readonly anchor: HTMLElement;
}

/** What an opened card shows under it: every chain's price, or a group's products. */
export type ProductRowExpanded = 'shops' | 'members';

/**
 * The one card that draws a catalog product (velista `0162`): the catalog tab,
 * Choose a product, the similar products of a product page and the search of a
 * list and of the shopping list. The differences between them are inputs, never a
 * second template.
 *
 * ## A row on a hairline, not a box (option A)
 *
 * The picture, the name over `brand · size · pack` and the chain line, the price,
 * and one control at the right edge. The host draws the hairline under each card
 * and none under the last of a list, because only the host knows which is last.
 *
 * ## One control that opens the product, and it covers the card
 *
 * The control is a button, or a link where the host has a URL for the product
 * (the search). Its press area is stretched over the whole card, so a press
 * anywhere on it opens the product. The other controls (the photo, the chain line,
 * the plus, the steppers) are its siblings and sit above that area: a button in a
 * button is not a control anybody can reach.
 *
 * The control's name is composed by the page, which has the translator and the
 * money helper: the product, the size and the price in that order, with
 * `no price` as words, so a screen reader hears what a sighted reader scans.
 *
 * ## One control slot
 *
 * The plus, a radio, a tick, a stepper or the verb pill, 44 wide, at the right
 * edge, never two. In a mode that chooses, the whole card is the label of its radio
 * or tick, so a press anywhere on it chooses and opens nothing.
 *
 * A host that sets more than one of them gets one, by this precedence: `choice`,
 * then `add` (with its held lines), then `stepper`. The others are not drawn.
 *
 * ## The lines that hold the product are under it, one stepper each
 *
 * A list can hold one product on several lines, so the card shows every line of
 * the chosen list that holds it, with its name and its own stepper.
 *
 * ## The price is never colour alone
 *
 * A missing price is the words `no price`, never a dash. A stale one is muted and
 * says how old it is, beside a clock.
 */
@Component({
  selector: 'lib-product-row',
  imports: [
    BasketIcon,
    ChevronDownIcon,
    ClockIcon,
    NgTemplateOutlet,
    PlusIcon,
    ProductPicture,
    QuantityStepper,
    RokuTranslatorPipe,
    RouterLink,
  ],
  template: `
    <ng-template #marks>
      @if (row().chains; as chains) {
        @for (mark of chains.marks; track mark.id; let first = $first) {
          <span aria-hidden="true" class="mark">{{ mark.initial }}</span>
          @if (first) {
            <span aria-hidden="true" class="lead">{{ chains.lead }}</span>
          }
        }
        @if (chains.more > 0) {
          <span aria-hidden="true" class="more">+{{ chains.more }}</span>
        }
      }
    </ng-template>

    <ng-template #content>
      <span class="what">
        @if (group() === null) {
          <span class="name">{{ row().name }}</span>
        } @else {
          <span class="name"
            >{{ row().name }}
            <span class="group-word">{{
              'list.add.card.groupBadge' | rokuT
            }}</span></span
          >
        }
        @if (row().detail; as detail) {
          <span class="detail">{{ detail }}</span>
        }
        @if (alsoCalled(); as also) {
          <span class="also">{{ also }}</span>
        }
        @if (row().caption; as caption) {
          <span class="caption">{{ caption }}</span>
        }
        @if (row().chains !== null && !chainsPress()) {
          <span class="chains">
            <ng-container [ngTemplateOutlet]="marks" />
          </span>
        }
      </span>

      @if (row().price; as price) {
        <span [class.is-stale]="row().stale" class="price">
          @if (group() !== null) {
            <span class="unit">{{ 'list.add.card.from' | rokuT }}</span>
          }
          <span class="amount">{{ price }}</span>
          @if (row().unitPrice; as unit) {
            <span class="unit">{{ unit }}</span>
          } @else if (row().seen; as seen) {
            <span class="unit seen">
              <lib-clock-icon aria-hidden="true" class="clock" />
              {{ seen }}
            </span>
          }
        </span>
      } @else if (group() === null) {
        <span class="no-price">{{ 'catalog.row.noPrice' | rokuT }}</span>
      }

      @if (verb(); as key) {
        <span aria-hidden="true" class="verb">{{ key | rokuT }}</span>
      }
    </ng-template>

    <div
      [attr.role]="grid() ? 'row' : null"
      [class.compact]="compact()"
      [class.has-control]="slot() === 'add' || slot() === 'stepper'"
      [class.is-chosen]="choice()?.checked === true"
      class="row"
    >
      <div [attr.role]="grid() ? 'gridcell' : null" class="cell">
        <!--
          The picture is a button of its own when it has a photo, which opens it
          large, so it stands before the control that opens the product and never
          inside it. A group draws the crate.
        -->
        @if (group() !== null) {
          <span aria-hidden="true" class="thumb crate">
            <lib-basket-icon />
          </span>
        } @else {
          <lib-product-picture
            [imageUrl]="row().imageUrl"
            [zoom]="row().name"
            class="thumb"
          />
        }

        @if (choice(); as picking) {
          <!--
            A mode that chooses (velista 0140, 0146): the whole card is the label of
            a radio or a tick at its trailing edge, so a press anywhere on it
            chooses the product and opens nothing.
          -->
          @if (picking.multiple === true) {
            <label class="open">
              <ng-container [ngTemplateOutlet]="content" />
              <!--
                A tick. The page decides the set, and may refuse a tick at the cap,
                so the box never ticks itself: the press is held back and the box
                follows what the page holds.
              -->
              <input
                (click)="$event.preventDefault(); chosen.emit(row().id)"
                [attr.aria-label]="row().label"
                [checked]="picking.checked"
                [disabled]="disabled()"
                class="pick pick-many"
                type="checkbox"
              />
            </label>
          } @else {
            <label class="open">
              <ng-container [ngTemplateOutlet]="content" />
              <input
                (change)="chosen.emit(row().id)"
                [attr.aria-label]="row().label"
                [checked]="picking.checked"
                [disabled]="disabled()"
                [name]="picking.name"
                class="pick"
                type="radio"
              />
            </label>
          }
        } @else if (group(); as grouped) {
          <!-- A group has no page of its own: a press opens its products. -->
          <button
            (click)="pressGroup()"
            [attr.aria-controls]="
              grouped.members.length > 0 ? row().id + '-inside' : null
            "
            [attr.aria-expanded]="
              grouped.members.length > 0 ? expanded() === 'members' : null
            "
            [attr.aria-label]="row().label"
            class="open"
            type="button"
          >
            <ng-container [ngTemplateOutlet]="content" />
          </button>
        } @else if (link(); as href) {
          <a [attr.aria-label]="row().label" [routerLink]="href" class="open">
            <ng-container [ngTemplateOutlet]="content" />
          </a>
        } @else if (openable()) {
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
            <ng-container [ngTemplateOutlet]="content" />
          </button>
        } @else {
          <!--
            A page that cannot open the product (a guest's basket): the card's words
            and nothing to press, so no button, no press area and no tab stop.
          -->
          <span class="open is-inert">
            <ng-container [ngTemplateOutlet]="content" />
          </span>
        }

        @if (chainsPress() || group()?.reveal) {
          <span class="foot">
            @if (chainsPress()) {
              <button
                (click)="expandToggled.emit('shops')"
                [attr.aria-controls]="row().id + '-shops'"
                [attr.aria-expanded]="expanded() === 'shops'"
                [attr.aria-label]="row().chains?.label"
                class="chains chains-press"
                type="button"
              >
                <ng-container [ngTemplateOutlet]="marks" />
                <lib-chevron-down-icon
                  [class.flipped]="expanded() === 'shops'"
                  aria-hidden="true"
                  class="foot-glyph"
                />
              </button>
            }
            @if (group()?.reveal; as reveal) {
              <!-- It states how many, which decides whether opening it is worth the room. -->
              <button
                (click)="expandToggled.emit('members')"
                [attr.aria-controls]="row().id + '-inside'"
                [attr.aria-expanded]="expanded() === 'members'"
                class="reveal"
                type="button"
              >
                {{ reveal }}
                <lib-chevron-down-icon
                  [class.flipped]="expanded() === 'members'"
                  aria-hidden="true"
                  class="foot-glyph"
                />
              </button>
            }
          </span>
        }

        @if (expanded() === 'shops' && shops().length > 0) {
          <!-- The chain line said who sells it; this says for how much. -->
          <ul
            [attr.aria-label]="'list.add.card.shops' | rokuT"
            [id]="row().id + '-shops'"
            class="shops"
          >
            @for (shop of shops(); track shop.id) {
              <li [class.best]="shop.best" class="shop">
                <span class="shop-name">{{ shop.name }}</span>
                @if (shop.note; as note) {
                  <span class="shop-note">{{ note }}</span>
                }
                @if (shop.price; as price) {
                  <span class="shop-price">{{ price }}</span>
                }
              </li>
            }
          </ul>
        }

        @if (expanded() === 'members' && members().length > 0) {
          <!--
            What a group is, then five products, cheapest first, and the count of
            the rest. A group with no members opens nothing, so nothing is drawn.
          -->
          <div [id]="row().id + '-inside'" class="inside">
            <p class="inside-help">
              {{ 'list.add.card.groupHelpBody' | rokuT }}
            </p>
            <ul class="inside-rows">
              @for (member of members(); track member.id) {
                <li class="inside-row">
                  <span class="inside-what">
                    <span class="inside-name">{{ member.name }}</span>
                    @if (member.brand; as brand) {
                      <span class="inside-brand">{{ brand }}</span>
                    }
                  </span>
                  @if (member.price; as price) {
                    <span class="inside-price">{{ price }}</span>
                  }
                </li>
              }
              @if (group()?.more; as more) {
                <li class="inside-more">{{ more }}</li>
              }
            </ul>
          </div>
        }
      </div>

      @if (slot() === 'add' && add(); as adding) {
        <div [attr.role]="grid() ? 'gridcell' : null" class="cell">
          <button
            (click)="pressAdd($event)"
            [attr.aria-label]="
              adding.label ??
              ('catalog.add.label'
                | rokuT: { name: row().name, list: adding.list })
            "
            class="add control"
            type="button"
          >
            <span class="add-dot"><lib-plus-icon /></span>
          </button>
        </div>
      } @else if (slot() === 'stepper' && stepper(); as stepping) {
        <div [attr.role]="grid() ? 'gridcell' : null" class="cell">
          <lib-quantity-stepper
            (stepped)="stepped.emit($event)"
            [accent]="stepping.value > 0"
            [compact]="true"
            [controlled]="true"
            [disabled]="stepping.disabled === true"
            [label]="stepping.label"
            [min]="stepping.min ?? 0"
            [value]="stepping.value"
            class="control stepper"
          />
        </div>
      }

      @if (slot() === 'add' && heldLines().length > 0) {
        <div [attr.role]="grid() ? 'gridcell' : null" class="cell">
          <div class="held">
            <span class="held-title">{{
              add()?.title ??
                ('catalog.held.title' | rokuT: { list: add()?.list })
            }}</span>
            <ul class="held-lines">
              @for (line of heldLines(); track line.lineId) {
                <li [attr.data-line]="line.lineId" class="held-line">
                  <span class="held-what">
                    @if (line.list; as list) {
                      <span class="held-list">{{ list }}</span>
                    }
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
                      line.stepperLabel ??
                      ('catalog.held.stepper'
                        | rokuT: { line: line.name, list: add()?.list })
                    "
                    [value]="line.quantity"
                  />
                </li>
              }
            </ul>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './product-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductRow {
  readonly row = input.required<ProductRowView>();

  /**
   * What pressing the card does, as a translation key drawn as a pill in the
   * control slot ("Change"), or null for a card that opens the product.
   *
   * The card stays one button with one name: a second button inside it would be
   * a button in a button. {@link verbLabel} is that name, with `{{label}}`
   * standing for the card's own.
   */
  readonly verb = input<string | null>(null);
  readonly verbLabel = input<string | null>(null);

  /** While the card's action is in flight. */
  readonly disabled = input(false);

  /** The plus, or null for a card that offers none. See {@link ProductRowAdd}. */
  readonly add = input<ProductRowAdd | null>(null);

  /**
   * A radio or a tick in the control slot, for the catalog opened to choose
   * (velista `0140`, `0146`), or null for a card that opens its product. Cards of
   * one list share the `name`.
   */
  readonly choice = input<ProductRowChoice | null>(null);

  /** A stepper in the control slot, for a compact card in a sheet, or null. */
  readonly stepper = input<ProductRowStepper | null>(null);

  /**
   * The smaller card for a list inside a sheet (velista `0163`): a 44 pixel
   * picture and no padding at the sides, because the sheet has its own.
   */
  readonly compact = input(false);

  /**
   * The URL of the product, for a card that opens it as a link (the search), or
   * null for one that reports the press through {@link opened}.
   */
  readonly link = input<string | null>(null);

  /**
   * Whether a press on the card can open the product where there is no
   * {@link link}: a host that listens to {@link opened}. False draws the card's
   * words with nothing to press (a guest's basket), because a button that opens
   * nothing is a dead tab stop announced as a control. A link, a group and a mode
   * that chooses ignore it.
   */
  readonly openable = input(true);

  /** A product group in place of a product (the search), or null. */
  readonly group = input<ProductRowGroup | null>(null);

  /**
   * Every chain's price, cheapest first (the search). With any, the chain line is
   * a button that opens them under the card; without, it is text.
   */
  readonly shops = input<readonly ProductRowShop[]>([]);

  /** "Also called: algodón", under the detail, or null (velista `0108`, target 4). */
  readonly alsoCalled = input<string | null>(null);

  /** What the card shows opened under it, or null. The host keeps one open. */
  readonly expanded = input<ProductRowExpanded | null>(null);

  /**
   * The card is a row of a `role="grid"` (the search, velista `0101` rule 8), and
   * its parts are its cells.
   */
  readonly grid = input(false);

  /** The card was chosen, in a mode that chooses. */
  readonly chosen = output<string>();

  /** The product's id, when the card is pressed. */
  readonly opened = output<string>();

  /** The plus was pressed: add one of this product. */
  readonly added = output<ProductRowAdded>();

  /** A press on the stepper of one line that holds the product. */
  readonly lineStepped = output<ProductRowLineStep>();

  /** A press on the stepper in the control slot. */
  readonly stepped = output<1 | -1>();

  /** The chain line or a group's reveal was pressed: open or close that part. */
  readonly expandToggled = output<ProductRowExpanded>();

  /** Whether the chain line is a button: the card knows each shop's price. */
  protected readonly chainsPress = computed(
    () => this.row().chains !== null && this.shops().length > 0
  );

  /**
   * Which control the trailing slot draws, one at most: a choice lives inside the
   * card's label and takes the slot from the plus and the stepper, and the plus
   * takes it from the stepper. Null for none.
   */
  protected readonly slot = computed((): 'choice' | 'add' | 'stepper' | null =>
    this.choice() !== null
      ? 'choice'
      : this.add() !== null
        ? 'add'
        : this.stepper() !== null
          ? 'stepper'
          : null
  );

  /** A group's products, empty for a product or a group with none. */
  protected readonly members = computed(
    (): readonly ProductRowMember[] => this.group()?.members ?? []
  );

  protected readonly heldLines = computed(
    (): readonly ProductRowHeldLine[] => this.add()?.lines ?? []
  );

  /** A group opens its products, and one with none has nothing to open. */
  protected pressGroup(): void {
    if (this.members().length > 0) {
      this.expandToggled.emit('members');
    }
  }

  protected pressAdd(event: Event): void {
    this.added.emit({
      id: this.row().id,
      anchor: event.currentTarget as HTMLElement,
    });
  }
}

/**
 * A card's shape with nothing in it, for the first page and the next one
 * (section 4). The same box as a card, so nothing moves when the cards arrive.
 */
@Component({
  selector: 'lib-product-row-skeleton',
  template: `
    <span [class.compact]="compact()" class="row skeleton">
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
export class ProductRowSkeleton {
  /** The compact size, for a list inside a sheet. */
  readonly compact = input(false);
}
