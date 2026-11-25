import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  isUnsavedLine,
  type HoldingRow,
  type LineUnit,
  type ListRowLayout,
  type ProductListGroup,
  type ProductListRow,
  type QuantityStep,
} from '@portfolio/velista/models';
import { QuantityReel } from '../list/quantity-reel';
import { QuantityStepper } from '../list/quantity-stepper';

/** A step of the stepper or the reel of one line, as the control drew it. */
export interface ListsTableStep {
  readonly listId: string;
  readonly lineId: string;
  readonly step: QuantityStep;
}

/**
 * A list with no line under the product's name, to make that line on (velista
 * `0203`). `quantity` is the amount a reel closed on, or null for a press of the
 * stepper's plus, which adds one step of the product as it always has.
 */
export interface ListsTableAdd {
  readonly listId: string;
  readonly quantity: number | null;
}

/**
 * The lists of every group and how many of one product each holds (velista
 * `0134`, section 7).
 *
 * ## One stepper for each list
 *
 * It shows the line that has the product under exactly the product's name, and
 * zero when the list has no such line. From zero the plus makes that line. After
 * that it moves it, by one step, as the list page does (velista `0187`, U5): a
 * plus on a list that holds a litre of milk asks for 1025 ml, not another litre.
 *
 * A list whose lines of the product are all under another name, or stocked at
 * zero, draws no stepper of its own. Those lines have their rows below, each with
 * a working stepper, and an add of a product the list already holds would add
 * nothing (decision B).
 *
 * ## A line under another name has its own row
 *
 * "Coffee for the machine" holds the same product and is somebody's own words. It
 * sits inset under its list with its own stepper, so a person sees that the list
 * already has the product and does not add it twice.
 *
 * ## A list the person only reads has no stepper
 *
 * It says so in words. A stepper that could never be pressed would be a question
 * with no answer.
 *
 * It decides nothing about saving. Each step goes out, and the store waits for
 * the presses to stop before it writes (velista `0188`, decision G).
 */
@Component({
  selector: 'lib-lists-table',
  imports: [QuantityReel, QuantityStepper, RokuTranslatorPipe],
  template: `
    @for (group of groups(); track group.zoneId) {
      <h3 class="group">{{ group.zoneName }}</h3>
      <ul class="lists">
        @for (list of group.lists; track list.listId) {
          <li [attr.data-list]="list.listId" class="list">
            <div class="row">
              <span class="what">
                <span [class.is-read]="!usable(list)" class="name">{{
                  list.name
                }}</span>
                @if (list.lastUsed) {
                  <span class="last">{{ 'catalog.inLists.last' | rokuT }}</span>
                }
                @if (!usable(list)) {
                  <!--
                    No stepper, so the words carry how many the list holds under
                    the product's own name.
                  -->
                  <span class="sub">{{
                    (quantityOf(list) > 0
                      ? 'catalog.inLists.readOnlyHolds'
                      : 'catalog.inLists.readOnly'
                    ) | rokuT: { count: quantityOf(list) }
                  }}</span>
                } @else if (list.main?.pending) {
                  <span class="sub">{{ 'catalog.added.pending' | rokuT }}</span>
                }
              </span>
              @if (ownStepper(list)) {
                @if (compact()) {
                  <!--
                    The compact view's reel (velista 0203): a line still being added
                    is not editable yet, so its reel reads and does not move.
                  -->
                  <lib-quantity-reel
                    (stepped)="reelMain(list, $event)"
                    [label]="
                      'amount.inList'
                        | rokuT: { name: product(), list: list.name }
                    "
                    [readonly]="readOnly(list) || unsaved(list)"
                    [step]="stepOf(list.main)"
                    [unit]="list.main?.unit ?? unit()"
                    [value]="quantityOf(list)"
                  />
                } @else {
                  <lib-quantity-stepper
                    (stepped)="stepMain(list, $event)"
                    [disabled]="unsaved(list)"
                    [name]="
                      'amount.inList'
                        | rokuT: { name: product(), list: list.name }
                    "
                    [readonly]="readOnly(list)"
                    [step]="stepOf(list.main)"
                    [unit]="list.main?.unit ?? unit()"
                    [value]="quantityOf(list)"
                    variant="row"
                  />
                }
              }
            </div>
            @for (line of list.others; track line.lineId) {
              <div [attr.data-line]="line.lineId" class="other">
                <span class="what">
                  <span class="other-name">{{ line.name }}</span>
                  <span class="sub">{{
                    (line.pending
                      ? 'catalog.inLists.otherPending'
                      : 'catalog.inLists.other'
                    ) | rokuT
                  }}</span>
                </span>
                @if (compact()) {
                  <lib-quantity-reel
                    (stepped)="
                      lineStepped.emit({
                        listId: list.listId,
                        lineId: line.lineId,
                        step: $event,
                      })
                    "
                    [label]="
                      'amount.inList'
                        | rokuT: { name: line.name, list: list.name }
                    "
                    [readonly]="!line.editable"
                    [step]="stepOf(line)"
                    [unit]="line.unit"
                    [value]="line.quantity"
                  />
                } @else {
                  <lib-quantity-stepper
                    (stepped)="
                      lineStepped.emit({
                        listId: list.listId,
                        lineId: line.lineId,
                        step: $event,
                      })
                    "
                    [disabled]="!line.editable"
                    [name]="
                      'amount.inList'
                        | rokuT: { name: line.name, list: list.name }
                    "
                    [step]="stepOf(line)"
                    [unit]="line.unit"
                    [value]="line.quantity"
                    variant="row"
                  />
                }
              </div>
            }
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './lists-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListsTable {
  readonly groups = input.required<readonly ProductListGroup[]>();

  /**
   * The product's name in the reader's language, which the stepper of each list
   * says its amount is of: "Leche on Weekly shop" (velista `0188`).
   */
  readonly product = input.required<string>();

  /**
   * What the product is asked for in, `lineUnitOfProduct` of the product shown:
   * the stepper of a list with no line of it counts in it at zero, so a product
   * sold by the litre reads "0 ml" and names a step of 25 ml.
   */
  readonly unit = input<LineUnit>('UNIT');

  /**
   * The product's step (velista `0186`, decision E), or null for the default.
   * Every stepper of the table steps a line that holds this one product, so each
   * reads it; a stepper that counts pieces ignores it.
   */
  readonly step = input<number | null>(null);

  /**
   * How the zone lists draw their rows on this device (velista `0202`): the stepper
   * in the default view, the reel in the compact one (velista `0203`).
   */
  readonly layout = input<ListRowLayout>('default');

  protected readonly compact = computed(() => this.layout() === 'compact');

  /**
   * The plus of a list with no line under the product's name, or its reel closed
   * above 0: make that line, at the reel's amount when a reel made it.
   */
  readonly added = output<ListsTableAdd>();

  /** A step of the stepper of a line that exists. */
  readonly lineStepped = output<ListsTableStep>();

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * The control a step or an add of one list was made on, and the row it sits in,
   * or null when the table no longer draws it (velista `0208`, target state 14):
   * the anchor of the question about the extra already bought. `lineId` names a
   * line under another name; null, or the line under the product's name, is the
   * list's own stepper or reel.
   */
  controlFor(
    listId: string,
    lineId: string | null
  ): { readonly control: HTMLElement; readonly row: HTMLElement } | null {
    const item = Array.from(
      this._host.nativeElement.querySelectorAll<HTMLElement>('li[data-list]')
    ).find((one) => one.dataset['list'] === listId);
    if (item === undefined) {
      return null;
    }
    const other =
      lineId === null
        ? undefined
        : Array.from(
            item.querySelectorAll<HTMLElement>(':scope > .other[data-line]')
          ).find((one) => one.dataset['line'] === lineId);
    const row = other ?? item.querySelector<HTMLElement>(':scope > .row');
    const control = row?.querySelector<HTMLElement>(
      ':scope > lib-quantity-stepper, :scope > lib-quantity-reel'
    );
    return row && control ? { control, row } : null;
  }

  /** Whether the list's own stepper can do anything for this person. */
  protected usable(list: ProductListRow): boolean {
    return list.canAdd || list.main?.editable === true;
  }

  /**
   * Whether the list's own row draws a stepper: a list the person can use, unless
   * every line of the product on it is under another name (decision B).
   */
  protected ownStepper(list: ProductListRow): boolean {
    return (
      this.usable(list) && (list.main !== null || list.others.length === 0)
    );
  }

  /**
   * Whether the line under the product's name is the one an add drew before it
   * answered. It is not editable yet, and that is not a missing right: its stepper
   * keeps both buttons, switched off, so the focus stays on the plus just pressed.
   */
  protected unsaved(list: ProductListRow): boolean {
    return list.main !== null && isUnsavedLine(list.main.lineId);
  }

  /** The amount and no buttons: the person may not change the line (decision C). */
  protected readOnly(list: ProductListRow): boolean {
    return list.main !== null && !list.main.editable && !this.unsaved(list);
  }

  /**
   * The step of one line's stepper: the line's own (`HoldingRow.step`, the step
   * the list page presses the same line by, decision A), and the product's only
   * while the line's is not known yet. A line known to step by the default
   * (null) keeps the default here too. A list with no line steps by the product.
   */
  protected stepOf(line: HoldingRow | null): number | null {
    return line?.step !== undefined ? line.step : this.step();
  }

  protected quantityOf(list: ProductListRow): number {
    return list.main?.quantity ?? 0;
  }

  /**
   * A step of a list's own stepper (velista `0187`, decisions A to C).
   *
   * - A list that holds the product under its name steps that line, a count as
   *   much as a weight, both ways, when the person may edit it (A). The store
   *   records it in the visit as it records a merged add.
   * - A person who may add and may not edit sees the amount and no buttons there,
   *   because an add on a list that holds the product adds nothing (C).
   * - A list with no line of the product adds on a plus, once per press: a repeat
   *   of a held plus at zero sends nothing. Every stepper's floor is zero.
   */
  protected stepMain(list: ProductListRow, step: QuantityStep): void {
    const main = list.main;
    if (main !== null) {
      if (main.editable) {
        this.lineStepped.emit({
          listId: list.listId,
          lineId: main.lineId,
          step,
        });
      }
      return;
    }
    if (
      step.to > step.from &&
      !step.repeat &&
      list.canAdd &&
      list.others.length === 0
    ) {
      this.added.emit({ listId: list.listId, quantity: null });
    }
  }

  /**
   * The one step of a list's own reel, in the compact view (velista `0203`). On a
   * line it steps the line as a press does. On a list with no line, a reel closed
   * above 0 makes the line at the reel's amount.
   */
  protected reelMain(list: ProductListRow, step: QuantityStep): void {
    const main = list.main;
    if (main !== null) {
      if (main.editable) {
        this.lineStepped.emit({
          listId: list.listId,
          lineId: main.lineId,
          step,
        });
      }
      return;
    }
    if (step.to > 0 && list.canAdd && list.others.length === 0) {
      this.added.emit({ listId: list.listId, quantity: step.to });
    }
  }
}
