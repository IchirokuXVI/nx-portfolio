import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ProductRow, type ProductRowView } from './product-row';

/** One line the visit added to, as its row draws it. */
export interface VisitAddedRow {
  readonly lineId: string;
  readonly itemId: string;
  /** What the line says. */
  readonly name: string;
  readonly detail: string | null;
  /** The photo of the product that was added, or null, which draws the glyph. */
  readonly imageUrl: string | null;
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
  readonly lineId: string;
  /** The product's detail, which the record keeps for the line. */
  readonly detail: string | null;
  /** The product's photo, which the record keeps for the line. */
  readonly imageUrl: string | null;
  readonly by: 1 | -1;
}

/**
 * What this visit to the catalog added (velista `0134`, section 4.4).
 *
 * One row for each line the visit added to, drawn as the compact product card
 * (velista `0163`): the photo, its name, the detail with the price, and a stepper
 * in the control slot. The card opens nothing here; the stepper is its control.
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
  imports: [ProductRow, RokuTranslatorPipe],
  template: `
    @for (section of sections(); track section.listId) {
      <section [attr.data-list]="section.listId" class="section">
        @if (sections().length > 1) {
          <h3 class="heading">{{ section.name }}</h3>
        }
        <ul class="rows">
          @for (row of section.rows; track row.lineId) {
            <li
              [attr.data-item]="row.itemId"
              [attr.data-line]="row.lineId"
              class="added-row"
            >
              <lib-product-row
                (stepped)="
                  stepped.emit({
                    listId: section.listId,
                    itemId: row.itemId,
                    lineId: row.lineId,
                    detail: row.detail,
                    imageUrl: row.imageUrl,
                    by: $event,
                  })
                "
                [compact]="true"
                [opens]="false"
                [priceShown]="false"
                [row]="viewOf(row, 'catalog.added.pending' | rokuT)"
                [stepper]="{
                  value: row.quantity,
                  label: 'catalog.added.stepper' | rokuT: { name: row.name },
                  min: row.floor - 1,
                }"
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

  /**
   * One row as the card draws it: the line's words, the detail with the price,
   * and "Waiting for approval" as the line under the detail when it waits.
   */
  protected viewOf(row: VisitAddedRow, pendingWords: string): ProductRowView {
    return {
      id: row.itemId,
      name: row.name,
      detail: row.detail,
      caption: row.pending ? pendingWords : null,
      imageUrl: row.imageUrl,
      price: null,
      unitPrice: null,
      seen: null,
      stale: false,
      chains: null,
      label: row.name,
      summary: row.detail,
    };
  }
}
