import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type {
  ProductListGroup,
  ProductListRow,
} from '@portfolio/velista/models';
import { QuantityStepper } from '../list/quantity-stepper';

/** A press on the stepper of one line. */
export interface ListsTableStep {
  readonly listId: string;
  readonly lineId: string;
  readonly by: 1 | -1;
}

/**
 * The lists of every group and how many of one product each holds (velista
 * `0134`, section 7).
 *
 * ## One stepper for each list
 *
 * It shows the line that has the product under exactly the product's name, and
 * zero when the list has no such line. From zero the plus makes that line. After
 * that it moves it.
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
 * It decides nothing about saving. Each press goes out, and the page writes it.
 */
@Component({
  selector: 'lib-lists-table',
  imports: [QuantityStepper, RokuTranslatorPipe],
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
              @if (usable(list)) {
                <lib-quantity-stepper
                  (stepped)="stepMain(list, $event)"
                  [accent]="quantityOf(list) > 0"
                  [controlled]="true"
                  [label]="
                    'catalog.inLists.stepper' | rokuT: { list: list.name }
                  "
                  [min]="floorOf(list)"
                  [value]="quantityOf(list)"
                />
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
                <lib-quantity-stepper
                  (stepped)="
                    lineStepped.emit({
                      listId: list.listId,
                      lineId: line.lineId,
                      by: $event,
                    })
                  "
                  [accent]="line.quantity > 0"
                  [compact]="true"
                  [controlled]="true"
                  [disabled]="!line.editable"
                  [label]="
                    'catalog.held.stepper'
                      | rokuT: { line: line.name, list: list.name }
                  "
                  [value]="line.quantity"
                />
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

  /** The plus of a list with no line under the product's name: make that line. */
  readonly added = output<string>();

  /** A press on the stepper of a line that exists. */
  readonly lineStepped = output<ListsTableStep>();

  /** Whether the list's own stepper can do anything for this person. */
  protected usable(list: ProductListRow): boolean {
    return list.canAdd || list.main?.editable === true;
  }

  protected quantityOf(list: ProductListRow): number {
    return list.main?.quantity ?? 0;
  }

  /**
   * The lowest value the list's stepper reaches. A person who may add and may not
   * change a quantity gets a plus and no minus, so the floor is where it stands.
   */
  protected floorOf(list: ProductListRow): number {
    return list.main?.editable === true ? 0 : this.quantityOf(list);
  }

  /**
   * A press on a list's own stepper. One more goes through an add wherever the
   * person may add: the server puts it on the line of that name or makes the line,
   * and an add asks for less than a change of quantity does.
   */
  protected stepMain(list: ProductListRow, by: 1 | -1): void {
    const main = list.main;
    if (by === 1 && list.canAdd) {
      this.added.emit(list.listId);
      return;
    }
    if (main !== null && main.editable) {
      this.lineStepped.emit({ listId: list.listId, lineId: main.lineId, by });
    }
  }
}
