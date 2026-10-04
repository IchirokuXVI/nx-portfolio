import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  type ResourceRowView,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { ReferencesControl } from '@portfolio/luna-shopper-admin/ui';
import {
  CategoryAssignReview,
  type CategoryCandidate,
  type NamedCategory,
} from './category-assign-review';

/** Only categories inside another: a product never goes on a root. */
const LEAVES = { kind: 'leaf' } as const;

/**
 * "Set categories" for the products ticked on the product list (admin plan
 * 0036).
 *
 * Two steps, and the second is the only one that writes: pick one or more
 * categories, in the order meant, then read the review naming every product,
 * what it has now and what it will have, and press its button. Cancelling at
 * either step leaves the ticks where they were.
 *
 * The migration of backend plan 0166 is why this exists at all: every
 * harvested product lands on an `other` category of its root, and moving them
 * onto real ones is a filter, a tick and a set.
 */
@Component({
  selector: 'lib-set-categories-panel',
  imports: [RokuTranslatorPipe, ReferencesControl, CategoryAssignReview],
  template: `
    @if (reviewing(); as target) {
      <lib-category-assign-review
        (cancelled)="reviewing.set(null)"
        (closed)="finish()($event)"
        [candidates]="candidates()"
        [target]="target"
      />
    } @else {
      <section
        [attr.aria-label]="'catalog.items.setCategories.heading' | rokuT"
        class="panel"
        role="group"
        data-set-categories
      >
        <h2>
          {{
            'catalog.items.setCategories.heading'
              | rokuT: { count: rows().length }
          }}
        </h2>
        <p class="muted">
          {{ 'catalog.items.setCategories.help' | rokuT }}
        </p>
        <div class="field">
          <label for="set-categories-target">{{
            'catalog.items.setCategories.categories' | rokuT
          }}</label>
          <lib-references-control
            (valueChange)="choose($event)"
            [controlId]="'set-categories-target'"
            [lookup]="references"
            [resource]="'categories'"
            [scope]="leaves"
            [value]="categoryIds()"
          />
        </div>
        <div class="controls">
          <button
            (click)="review()"
            [disabled]="categoryIds().length === 0 || resolving()"
            class="primary"
            type="button"
            data-set-categories-review
          >
            {{ 'catalog.items.setCategories.review' | rokuT }}
          </button>
          <button
            (click)="finish()(false)"
            type="button"
            data-set-categories-cancel
          >
            {{ 'resource.action.cancel' | rokuT }}
          </button>
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      inline-size: 100%;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      max-inline-size: 48rem;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-accent);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      inline-size: 100%;
      max-inline-size: 32rem;
    }

    .field > label {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
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
export class SetCategoriesPanel {
  /** The ticked product rows, as the list drew them. */
  readonly rows = input.required<readonly ResourceRowView[]>();
  /** Close the panel; `true` when products moved. */
  readonly finish = input.required<(changed: boolean) => void>();

  readonly references = inject(ResourceReferences);
  private readonly _content = inject(ContentLocaleStore);

  readonly leaves = LEAVES;

  /** The categories picked, in the order picked. The first is first. */
  readonly categoryIds = signal<readonly string[]>([]);
  /** Whether the names of the picked categories are still being read. */
  readonly resolving = signal(false);
  readonly reviewing = signal<readonly NamedCategory[] | null>(null);

  /** Each ticked product and the categories its row carries, by name. */
  readonly candidates = computed<readonly CategoryCandidate[]>(() => {
    const order = this._content.order();
    return this.rows().map((view) => {
      const item = view.row as unknown as Wire.CatalogItemView;
      return {
        id: view.id,
        title: view.title,
        current: (item.categories ?? []).map((category) => ({
          id: category.id,
          name: localizedTextValue(category.name, order) || category.slug,
        })),
      };
    });
  });

  choose(ids: readonly string[]): void {
    this.categoryIds.set(ids);
  }

  /**
   * Open the review, with the picked categories named. Nothing is sent until
   * its own button is pressed.
   */
  async review(): Promise<void> {
    const ids = this.categoryIds();
    if (ids.length === 0 || this.resolving()) {
      return;
    }
    this.resolving.set(true);
    try {
      const named = await Promise.all(
        ids.map(async (id) => {
          const option = await this.references.resolve('categories', id);
          return { id, name: option?.title ?? id };
        })
      );
      // The pick may have changed while the names were read.
      if (this.categoryIds() === ids) {
        this.reviewing.set(named);
      }
    } finally {
      this.resolving.set(false);
    }
  }
}
