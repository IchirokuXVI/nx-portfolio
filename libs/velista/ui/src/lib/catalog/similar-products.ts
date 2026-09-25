import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { similarProducts, type CatalogItem } from '@portfolio/velista/models';
import {
  ProductRow,
  ProductRowSkeleton,
  type ProductRowView,
} from './product-row';
import { productRowView } from './product-row-view';

/**
 * The other products of a product's group: "similar products".
 *
 * A group is one product sold under several labels, so every row here is a
 * product the reader can take instead, and the list is ordered cheapest first
 * by the price per litre or kilo, which is how the members compare.
 *
 * The page decides what a row does. With {@link verb} null a row opens the
 * product, as on the product sheet. With a verb ("Change") a row does that
 * instead, as on the line page and the basket's change sheet.
 *
 * **Nothing is drawn** while the members load, when the product has no
 * siblings, or with no group at all: a heading over an empty list would promise
 * alternatives that do not exist. A failed read says so in one line.
 */
@Component({
  selector: 'lib-similar-products',
  imports: [ProductRow, ProductRowSkeleton, RokuTranslatorPipe],
  template: `
    @if (failed()) {
      <p class="failed">{{ 'catalog.similar.failed' | rokuT }}</p>
    } @else if (members() === null) {
      @if (loading()) {
        <lib-product-row-skeleton />
      }
    } @else if (rows().length > 0) {
      <h2 class="title">{{ headingKey() | rokuT: headingArgs() }}</h2>
      <ul class="rows">
        @for (row of rows(); track row.id) {
          <li>
            <lib-product-row
              (opened)="picked.emit($event)"
              [disabled]="busy()"
              [row]="row"
              [verb]="verb()"
              [verbLabel]="verbLabel()"
            />
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .title {
      margin: 0 0 var(--app-space-4);
      font-size: var(--app-text-base);
      font-weight: 650;
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--app-space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .failed {
      margin: 0;
      font-size: var(--app-text-sm);
      color: var(--app-text-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimilarProducts {
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);

  /** The group's members, or null while they load or with no group. */
  readonly members = input.required<readonly CatalogItem[] | null>();
  /** The products the rows must leave out: the product itself, and its line's others. */
  readonly excludeIds = input<readonly string[]>([]);
  /** Draw a placeholder row while {@link members} is null. */
  readonly loading = input(false);
  readonly failed = input(false);
  readonly headingKey = input('catalog.similar.title');
  readonly headingArgs = input<Record<string, unknown> | undefined>(undefined);
  /** See `ProductRow.verb`. Null: a row opens the product. */
  readonly verb = input<string | null>(null);
  readonly verbLabel = input<string | null>(null);
  readonly busy = input(false);

  /** The id of the row pressed. */
  readonly picked = output<string>();

  protected readonly rows = computed<readonly ProductRowView[]>(() => {
    const members = this.members();
    if (members === null) {
      return [];
    }
    const locale = this._locale();
    this._translator.loaded();
    return similarProducts(members, this.excludeIds()).map((member) =>
      productRowView(member, {
        locale,
        // The unit price under each price, because that is what compares them.
        chainChosen: true,
        chainOf: () => null,
        translate: (key, args) =>
          this._translator.t(key, undefined, locale, args),
      })
    );
  });
}
