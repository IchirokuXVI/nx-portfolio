import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { ProductCategoriesBatch } from './product-categories-batch';

/** A category, as the review names it. */
export interface NamedCategory {
  readonly id: string;
  readonly name: string;
}

/** A product somebody ticked, and the categories it has now. */
export interface CategoryCandidate {
  readonly id: string;
  readonly title: string;
  readonly current: readonly NamedCategory[];
}

/** One line of the review: a product, where it is, and where it is going. */
interface ReviewLine {
  readonly candidate: CategoryCandidate;
  /** Whether it already has exactly these categories, in this order. */
  readonly unchanged: boolean;
  /** What it has after the write, once the answer is in. */
  readonly after: readonly NamedCategory[] | null;
}

/**
 * The review before products are given other categories, and the answer after
 * (admin plan 0036, in the pattern of admin plan 0035).
 *
 * **The only place "Set categories" writes from.** It names every ticked
 * product, the categories it has now and the ones it will have, and nothing is
 * sent until its button is pressed. The new set **replaces** each product's
 * set, which is what an operator moving products off `other-frozen` means. A
 * product that already has exactly that set is named too, and left out of the
 * request, because rewriting it would change nothing.
 *
 * **The answer is all or nothing**, because the route is (backend plan 0166).
 * Either every product moved, and each line says what it has now as the server
 * answered it, or the request was refused as a whole: one sentence says why,
 * and every line says it did not change, rather than looking as if it had.
 */
@Component({
  selector: 'lib-category-assign-review',
  imports: [RokuTranslatorPipe],
  template: `
    <section
      (keydown.escape)="back()"
      [attr.aria-label]="'catalog.items.setCategories.reviewHeading' | rokuT"
      class="review"
      role="group"
      tabindex="-1"
      data-categories-review
    >
      <h2>
        {{
          (applied()
            ? 'catalog.items.setCategories.applied'
            : 'catalog.items.setCategories.reviewHeading'
          ) | rokuT: { count: moving().length, categories: targetNames() }
        }}
      </h2>
      @if (!applied()) {
        <p class="muted">
          {{ 'catalog.items.setCategories.lead' | rokuT }}
        </p>
      }

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">
                {{ 'catalog.items.setCategories.product' | rokuT }}
              </th>
              <th scope="col">
                {{ 'catalog.items.setCategories.now' | rokuT }}
              </th>
              <th scope="col">
                {{
                  (applied()
                    ? 'catalog.items.setCategories.result'
                    : 'catalog.items.setCategories.after'
                  ) | rokuT
                }}
              </th>
            </tr>
          </thead>
          <tbody>
            @for (line of lines(); track line.candidate.id) {
              <tr
                [attr.data-outcome]="lineState(line)"
                [attr.data-review-item]="line.candidate.id"
              >
                <th scope="row">{{ line.candidate.title }}</th>
                <td>
                  @if (line.candidate.current.length === 0) {
                    <span class="muted">{{
                      'catalog.items.setCategories.none' | rokuT
                    }}</span>
                  } @else {
                    {{ namesOf(line.candidate.current) }}
                  }
                </td>
                <td>
                  @if (line.unchanged) {
                    <span class="muted">{{
                      'catalog.items.setCategories.alreadyThere' | rokuT
                    }}</span>
                  } @else if (line.after; as after) {
                    <strong>{{ namesOf(after) }}</strong>
                  } @else if (refused()) {
                    <span class="muted">{{
                      'catalog.items.setCategories.notChanged' | rokuT
                    }}</span>
                  } @else {
                    <strong>{{ targetNames() }}</strong>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (errorKey(); as key) {
        <div class="failure" role="alert" data-categories-refused>
          <p>
            <strong>{{ 'catalog.items.setCategories.refused' | rokuT }}</strong>
            {{ key | rokuT }}
          </p>
          @if (unknown().length > 0) {
            <p class="detail">
              {{
                'catalog.items.setCategories.unknown'
                  | rokuT: { names: unknown().join(', ') }
              }}
            </p>
          }
        </div>
      }

      <div class="controls">
        @if (applied()) {
          <button (click)="close()" class="primary" type="button" data-close>
            {{ 'catalog.items.setCategories.close' | rokuT }}
          </button>
        } @else {
          <button
            (click)="send()"
            [disabled]="sending() || moving().length === 0"
            class="primary"
            type="button"
            data-categories-send
          >
            {{
              (sending()
                ? 'resource.action.working'
                : 'catalog.items.setCategories.confirm'
              ) | rokuT: { count: moving().length }
            }}
          </button>
          <button
            (click)="back()"
            [disabled]="sending()"
            type="button"
            data-categories-back
          >
            {{ 'catalog.items.setCategories.back' | rokuT }}
          </button>
        }
      </div>
    </section>
  `,
  styles: `
    .review {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      max-inline-size: 60rem;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .scroll {
      inline-size: 100%;
      overflow-x: auto;
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    th,
    td {
      padding: var(--admin-space-2) var(--admin-space-3) var(--admin-space-2) 0;
      text-align: start;
      vertical-align: baseline;
    }

    thead th {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    tbody tr {
      border-block-start: 1px solid var(--admin-border);
    }

    tbody th {
      font-weight: 600;
    }

    .muted,
    .detail {
      color: var(--admin-ink-muted);
    }

    .detail {
      font-size: 0.8125rem;
    }

    .failure {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      inline-size: 100%;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
      color: var(--admin-danger-on-wash);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }

    button {
      min-block-size: var(--admin-control);
      padding: var(--admin-control-pad) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      cursor: pointer;
    }

    button.primary {
      border-color: transparent;
      background: var(--admin-accent);
      color: var(--admin-accent-ink);
    }

    button:disabled {
      opacity: 0.55;
      cursor: default;
    }

    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryAssignReview {
  private readonly _batch = inject(ProductCategoriesBatch);
  private readonly _content = inject(ContentLocaleStore);

  /** Every ticked product, including any that already has these categories. */
  readonly candidates = input.required<readonly CategoryCandidate[]>();
  /** The categories every product is about to have, in the order meant. */
  readonly target = input.required<readonly NamedCategory[]>();

  /** Back to choosing, with nothing sent. */
  readonly cancelled = output<void>();
  /** The answer has been read. `true` when products moved. */
  readonly closed = output<boolean>();

  readonly sending = signal(false);
  /** What each product has now, by id, once the write went through. */
  private readonly _written = signal<ReadonlyMap<
    string,
    readonly NamedCategory[]
  > | null>(null);
  private readonly _error = signal<GatewayError | null>(null);

  readonly applied = computed(() => this._written() !== null);
  readonly refused = computed(() => this._error() !== null);
  readonly errorKey = computed(() => gatewayErrorKey(this._error()));

  /**
   * The slugs or ids the refusal said name nothing, for `category_not_found`.
   * A category somebody deleted between the pick and the press is the case.
   */
  readonly unknown = computed<readonly string[]>(() => {
    const listed = this._error()?.details['unknown'];
    return Array.isArray(listed)
      ? listed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  });

  readonly targetNames = computed(() => this.namesOf(this.target()));

  readonly lines = computed<readonly ReviewLine[]>(() => {
    const ids = this.target().map((category) => category.id);
    const written = this._written();
    return this.candidates().map((candidate) => ({
      candidate,
      unchanged: sameOrder(
        candidate.current.map((category) => category.id),
        ids
      ),
      after: written?.get(candidate.id) ?? null,
    }));
  });

  /** The products the request names: everything that would change. */
  readonly moving = computed(() =>
    this.lines()
      .filter((line) => !line.unchanged)
      .map((line) => line.candidate)
  );

  /**
   * Send the reviewed products in one request. A refusal keeps the review
   * open with its sentence, so the operator can go back and pick again.
   */
  async send(): Promise<void> {
    const moving = this.moving();
    if (this.sending() || moving.length === 0) {
      return;
    }
    const categoryIds = this.target().map((category) => category.id);

    this.sending.set(true);
    this._error.set(null);
    try {
      const rows = await this._batch.set(
        moving.map((candidate) => ({ itemId: candidate.id, categoryIds }))
      );
      this._written.set(this._namesByItem(rows));
    } catch (error) {
      this._error.set(error as GatewayError);
    } finally {
      this.sending.set(false);
    }
  }

  back(): void {
    if (this.sending() || this.applied()) {
      return;
    }
    this.cancelled.emit();
  }

  close(): void {
    this.closed.emit(this.applied());
  }

  /** A line's state, for styling and for a spec to read. */
  lineState(line: ReviewLine): string {
    if (line.unchanged) {
      return 'unchanged';
    }
    if (line.after !== null) {
      return 'moved';
    }
    return this.refused() ? 'refused' : 'pending';
  }

  namesOf(categories: readonly NamedCategory[]): string {
    return categories.map((category) => category.name).join(', ');
  }

  /** Each product's categories as the server answered them. */
  private _namesByItem(
    rows: readonly Wire.CatalogItemView[]
  ): ReadonlyMap<string, readonly NamedCategory[]> {
    const order = this._content.order();
    return new Map(
      rows.map((row) => [
        row.id,
        (row.categories ?? []).map((category) => ({
          id: category.id,
          name: localizedTextValue(category.name, order) || category.slug,
        })),
      ])
    );
  }
}

/** Whether two lists hold the same ids in the same order. */
function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}
