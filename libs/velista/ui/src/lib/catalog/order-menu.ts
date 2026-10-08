import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { CatalogOrder } from '@portfolio/velista/models';
import { ChevronDownIcon } from '../icons/icons';
import {
  AnchoredPopover,
  type AnchoredPopoverClose,
} from '../list/anchored-popover';

/** Numbers each menu's group, so two on a page never share an id. */
let menuCount = 0;

/**
 * The order of the catalog's list, on the line that heads it (velista `0134`,
 * section 3).
 *
 * "Order: Catalog" and a chevron. A press opens a popover with one radio row for
 * each order the read can serve, and each row says in one short line what the
 * order does. The pills this replaces took a row of their own and could not say
 * that.
 *
 * **It draws only the orders it is given.** The page asks the model which orders
 * exist for the text in the field, so Best match is a row only while there is
 * something to match, and no row is drawn for an order the read cannot serve.
 *
 * A press chooses and closes, and focus goes back to the control, because that is
 * where the person was.
 */
@Component({
  selector: 'lib-order-menu',
  imports: [AnchoredPopover, ChevronDownIcon, RokuTranslatorPipe],
  template: `
    <button
      (click)="toggle()"
      [attr.aria-expanded]="open()"
      #trigger
      aria-haspopup="true"
      class="control"
      type="button"
    >
      <span class="control-key">{{ 'catalog.order.label' | rokuT }}:</span>
      <span class="control-value">{{
        'catalog.order.short.' + selected() | rokuT
      }}</span>
      <lib-chevron-down-icon class="control-chevron" />
    </button>

    @if (open()) {
      <lib-anchored-popover
        (closed)="close($event)"
        [labelledBy]="titleId"
        [open]="true"
        [origin]="trigger"
        align="end"
        side="below"
      >
        <span [id]="titleId" class="visually-hidden">{{
          'catalog.order.label' | rokuT
        }}</span>
        <div
          (keydown)="onKey($event)"
          [attr.aria-labelledby]="titleId"
          class="options"
          role="radiogroup"
          tabindex="-1"
        >
          @for (order of orders(); track order) {
            <button
              (click)="choose(order)"
              [attr.aria-checked]="order === selected()"
              [attr.data-order]="order"
              [attr.tabindex]="order === selected() ? 0 : -1"
              [class.is-on]="order === selected()"
              class="option"
              role="radio"
              type="button"
            >
              <span aria-hidden="true" class="radio"></span>
              <span class="option-text">
                <span class="option-name">{{
                  'catalog.order.' + order | rokuT
                }}</span>
                <span class="option-hint">{{
                  'catalog.order.hint.' + order | rokuT
                }}</span>
              </span>
            </button>
          }
        </div>
      </lib-anchored-popover>
    }
  `,
  styleUrl: './order-menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderMenu {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _trigger =
    viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  /** The orders on offer, in the order they are drawn. */
  readonly orders = input.required<readonly CatalogOrder[]>();
  readonly selected = input.required<CatalogOrder>();

  readonly chosen = output<CatalogOrder>();

  protected readonly open = signal(false);
  protected readonly titleId = `order-menu-title-${++menuCount}`;

  protected toggle(): void {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    this.open.set(true);
    // The popover is drawn in the top layer after this render. Focus goes to the
    // chosen row, which is where a radio group is entered.
    afterNextRender(() => this._focusOption(this.selected()), {
      injector: this._injector,
    });
  }

  protected choose(order: CatalogOrder): void {
    this.open.set(false);
    this._trigger().nativeElement.focus();
    if (order !== this.selected()) {
      this.chosen.emit(order);
    }
  }

  protected close(reason: AnchoredPopoverClose): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    if (reason === 'escape') {
      this._trigger().nativeElement.focus();
    }
  }

  /** The arrow keys move between the rows, as they do in any radio group. */
  protected onKey(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const orders = this.orders();
    const focused = (event.target as HTMLElement).dataset['order'];
    const at = orders.findIndex((order) => order === focused);
    const next = orders[(at + step + orders.length) % orders.length];
    if (next !== undefined) {
      this._focusOption(next);
    }
  }

  private _focusOption(order: CatalogOrder): void {
    // The overlay is an inline popover, inserted right after its anchor, so it is
    // found from the anchor's parent.
    const scope = this._host.nativeElement.ownerDocument;
    scope
      .querySelector<HTMLElement>(
        `[aria-labelledby="${this.titleId}"] [data-order="${order}"]`
      )
      ?.focus();
  }
}
