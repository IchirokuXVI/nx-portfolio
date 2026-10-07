import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { QuantityStepper } from '../list/quantity-stepper';

/** One product the visit added, as its row draws it. */
export interface VisitAddedRow {
  readonly itemId: string;
  readonly name: string;
  readonly detail: string | null;
  /** How many the list holds now. */
  readonly quantity: number;
  /** The lowest count the stepper shows. A minus pressed there takes it back. */
  readonly floor: number;
  /** The line waits for approval, which the row says under the name. */
  readonly pending: boolean;
}

/** One list's part of the sheet. */
export interface VisitAddedSection {
  readonly listId: string;
  /** The list's name. Drawn as a heading only when there are two sections. */
  readonly name: string;
  readonly rows: readonly VisitAddedRow[];
}

/** A press on one row's stepper. */
export interface VisitAddedStep {
  readonly listId: string;
  readonly itemId: string;
  readonly by: 1 | -1;
}

/**
 * What this visit to the catalog added (velista `0134`, section 4.4).
 *
 * One row for each product: the name, the detail with its price, and a stepper.
 * **The minus at the floor takes the product back**, so the stepper's lowest value
 * is one under the floor and the container reads a step down from the floor as
 * the undo. One quiet button takes back everything on a list, and a link opens
 * the list.
 *
 * Products added to two lists sit under two headings, one for each list. With one
 * list the sheet's title already names it and no heading is drawn.
 */
@Component({
  selector: 'lib-visit-added',
  imports: [QuantityStepper, RokuTranslatorPipe],
  template: `
    @for (section of sections(); track section.listId) {
      <section [attr.data-list]="section.listId" class="section">
        @if (sections().length > 1) {
          <h3 class="heading">{{ section.name }}</h3>
        }
        <ul class="rows">
          @for (row of section.rows; track row.itemId) {
            <li [attr.data-item]="row.itemId" class="row">
              <span class="what">
                <span class="name">{{ row.name }}</span>
                @if (row.detail; as detail) {
                  <span class="detail">{{ detail }}</span>
                }
                @if (row.pending) {
                  <span class="pending">{{
                    'catalog.added.pending' | rokuT
                  }}</span>
                }
              </span>
              <lib-quantity-stepper
                (stepped)="
                  stepped.emit({
                    listId: section.listId,
                    itemId: row.itemId,
                    by: $event,
                  })
                "
                [accent]="true"
                [compact]="true"
                [controlled]="true"
                [label]="'catalog.added.stepper' | rokuT: { name: row.name }"
                [min]="row.floor - 1"
                [value]="row.quantity"
              />
            </li>
          }
        </ul>
        <button
          (click)="allTakenBack.emit(section.listId)"
          class="quiet"
          type="button"
          data-added="take-all"
        >
          {{ 'catalog.added.takeAll' | rokuT: { count: section.rows.length } }}
        </button>
        <button
          (click)="listOpened.emit(section.listId)"
          class="open"
          type="button"
          data-added="open-list"
        >
          {{ 'catalog.added.open' | rokuT: { list: section.name } }}
        </button>
      </section>
    }
  `,
  styleUrl: './visit-added.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisitAdded {
  readonly sections = input.required<readonly VisitAddedSection[]>();

  readonly stepped = output<VisitAddedStep>();
  /** Take back everything the visit added to this list. */
  readonly allTakenBack = output<string>();
  /** Open this list. */
  readonly listOpened = output<string>();
}
