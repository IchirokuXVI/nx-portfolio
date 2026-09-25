import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { CatalogOrder } from '@portfolio/velista/models';

let nextGroup = 0;

/**
 * The order of the catalog tab's list (velista `0100`, section 2).
 *
 * A radio group, because exactly one order is on (section 7). Real radios inside
 * the pills, so the arrow keys move the choice the way every radio group does,
 * and the visible `Order` is the group's legend.
 *
 * Which pills exist is the page's to say: `Best match` only while there is
 * something to match (rule C2).
 */
@Component({
  selector: 'lib-order-pills',
  imports: [RokuTranslatorPipe],
  template: `
    <fieldset class="pills">
      <legend class="legend">{{ 'catalog.order.label' | rokuT }}</legend>
      @for (order of orders(); track order) {
        <label [class.is-on]="selected() === order" class="pill">
          <input
            (change)="chosen.emit(order)"
            [checked]="selected() === order"
            [name]="group"
            [value]="order"
            class="radio"
            type="radio"
          />
          {{ 'catalog.order.' + order | rokuT }}
        </label>
      }
    </fieldset>
  `,
  styleUrl: './order-pills.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderPills {
  readonly orders = input.required<readonly CatalogOrder[]>();
  readonly selected = input.required<CatalogOrder>();

  readonly chosen = output<CatalogOrder>();

  /** One radio group per instance, so two lists on a page never share a choice. */
  protected readonly group = `catalog-order-${nextGroup++}`;
}
