import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  ResourceRowView,
  Wire,
} from '@portfolio/luna-shopper-admin/models';
import { ReferencePicker } from '@portfolio/luna-shopper-admin/ui';
import {
  GroupAssignReview,
  type GroupCandidate,
  type GroupTarget,
} from './group-assign-review';
import { GroupNames } from './group-names';

/**
 * "Set group" for the products ticked on the product list (admin plan 0035,
 * section 2).
 *
 * Two steps, and the second is the only one that writes: choose the group, then
 * read the review that names every product, where it is now and where it is
 * going, and press its button. Cancelling at either step leaves the ticks where
 * they were.
 *
 * Opened by the generic list as a bulk action's panel, which is why its inputs
 * are the list's `rows` and `finish` rather than anything about products.
 */
@Component({
  selector: 'lib-set-group-panel',
  imports: [RokuTranslatorPipe, ReferencePicker, GroupAssignReview],
  template: `
    @if (reviewing(); as target) {
      <lib-group-assign-review
        (cancelled)="reviewing.set(null)"
        (closed)="finish()($event)"
        [candidates]="candidates()"
        [group]="target"
      />
    } @else {
      <section
        [attr.aria-label]="'catalog.items.setGroup.heading' | rokuT"
        class="panel"
        role="group"
        data-set-group
      >
        <h2>
          {{
            'catalog.items.setGroup.heading' | rokuT: { count: rows().length }
          }}
        </h2>
        <div class="field">
          <label for="set-group-target">{{
            'catalog.items.setGroup.group' | rokuT
          }}</label>
          <lib-reference-picker
            (valueChange)="choose($event)"
            [controlId]="'set-group-target'"
            [lookup]="references"
            [resource]="'product-groups'"
            [value]="groupId()"
          />
        </div>
        <div class="controls">
          <button
            (click)="review()"
            [disabled]="target() === null"
            class="primary"
            type="button"
            data-set-group-review
          >
            {{ 'catalog.items.setGroup.review' | rokuT }}
          </button>
          <button (click)="finish()(false)" type="button" data-set-group-cancel>
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

    .field {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      inline-size: 100%;
      max-inline-size: 24rem;
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
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
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
export class SetGroupPanel {
  /** The ticked product rows, as the list drew them. */
  readonly rows = input.required<readonly ResourceRowView[]>();
  /** Close the panel; `true` when products moved. */
  readonly finish = input.required<(changed: boolean) => void>();

  readonly references = inject(ResourceReferences);
  private readonly _names = new GroupNames(this.references);

  readonly groupId = signal('');
  readonly target = signal<GroupTarget | null>(null);
  readonly reviewing = signal<GroupTarget | null>(null);

  readonly candidates = computed<readonly GroupCandidate[]>(() => {
    const names = this._names.names();
    return this.rows().map((view) => {
      const item = view.row as unknown as Wire.CatalogItemView;
      const current = item.productGroupId ?? null;
      return {
        id: view.id,
        title: view.title,
        currentGroupId: current,
        currentGroupName:
          current === null ? null : (names.get(current) ?? null),
      };
    });
  });

  constructor() {
    effect(() => {
      const ids = this.rows().map(
        (view) =>
          (view.row as unknown as Wire.CatalogItemView).productGroupId ?? null
      );
      untracked(() => void this._names.resolve(ids));
    });
  }

  /** A group was picked. Its name is read so the review can say it. */
  async choose(id: string): Promise<void> {
    this.groupId.set(id);
    this.target.set(null);
    if (id === '') {
      return;
    }
    const option = await this.references.resolve('product-groups', id);
    if (this.groupId() === id) {
      this.target.set({ id, name: option?.title ?? id });
    }
  }

  /** Open the review. Nothing is sent until its own button is pressed. */
  review(): void {
    const target = this.target();
    if (target !== null) {
      this.reviewing.set(target);
    }
  }
}
