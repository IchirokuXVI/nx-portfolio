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
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  GatewayError,
  RESOURCE_GATEWAYS,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceReferences,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { localizedTextValue } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
import { sectionSource } from './catalog-sources';
import { ShopSections, type ShopSection } from './shop-sections';

/** One category a section covers, by name. */
export interface CoveredCategory {
  readonly id: string;
  readonly name: string;
  /** A top level category, which covers every category inside it. */
  readonly root: boolean;
}

/** A failure, as the sentence a panel shows. */
export function panelErrorKey(error: unknown): string {
  return error instanceof GatewayError
    ? (gatewayErrorKey(error) ?? 'resource.error.unknown')
    : 'resource.error.unknown';
}

/**
 * A chain's sections, on the chain's own screen (admin plan 0037, target 1).
 *
 * In `position` order, which is the order a shop with no list of its own
 * walks them. Each row names the categories it covers, a top level one marked
 * as covering all of its children, and counts the shops it is present at.
 *
 * Creating and editing open the `sections` form. Deleting is here, because the
 * confirmation has to say what goes with a section: it leaves every shop's
 * list and every pin, and a shop that listed only it falls back to the chain.
 */
@Component({
  selector: 'lib-chain-sections',
  imports: [RouterLink, RokuTranslatorPipe, ConfirmDialog],
  template: `
    <section aria-labelledby="chain-sections-heading">
      <div class="head">
        <h2 id="chain-sections-heading">
          {{ 'catalog.chainSections.heading' | rokuT }}
        </h2>
        @if (newLink(); as link) {
          <a
            [queryParams]="{ supermarketId: supermarketId() }"
            [routerLink]="link"
            class="button"
            >{{ 'catalog.chainSections.add' | rokuT }}</a
          >
        }
      </div>

      @if (loading() && sections().length === 0) {
        <p class="muted" role="status">
          {{ 'resource.list.loading' | rokuT }}
        </p>
      } @else if (errorKey(); as key) {
        <div class="failure" role="alert">
          <p>{{ key | rokuT }}</p>
          <button (click)="reload()" type="button">
            {{ 'resource.action.retry' | rokuT }}
          </button>
        </div>
      } @else if (sections().length === 0) {
        <p class="empty">{{ 'catalog.chainSections.empty' | rokuT }}</p>
      } @else {
        @if (deleteErrorKey(); as key) {
          <p class="failure" role="alert">{{ key | rokuT }}</p>
        }
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th class="num" scope="col">
                  {{ 'catalog.sections.position' | rokuT }}
                </th>
                <th scope="col">{{ 'catalog.sections.name' | rokuT }}</th>
                <th scope="col">{{ 'catalog.sections.slug' | rokuT }}</th>
                <th scope="col">
                  {{ 'catalog.sections.categoryIds' | rokuT }}
                </th>
                <th class="num" scope="col">
                  {{ 'catalog.sections.locationCount' | rokuT }}
                </th>
                <th scope="col">
                  <span class="visually-hidden">{{
                    'catalog.chainSections.actions' | rokuT
                  }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (section of sections(); track section.id) {
                <tr>
                  <td class="num">{{ section.position }}</td>
                  <td class="name">{{ nameOf(section) }}</td>
                  <td class="mono">{{ section.slug }}</td>
                  <td>
                    @for (category of covered(section); track category.id) {
                      <span [class.root]="category.root" class="chip">{{
                        category.root
                          ? ('catalog.chainSections.coversAll'
                            | rokuT: { name: category.name })
                          : category.name
                      }}</span>
                    } @empty {
                      <span class="muted">{{
                        'catalog.chainSections.coversNothing' | rokuT
                      }}</span>
                    }
                  </td>
                  <td class="num">{{ section.locationCount ?? '' }}</td>
                  <td class="actions">
                    @if (editLink(section.id); as link) {
                      <a [routerLink]="link">{{
                        'resource.action.edit' | rokuT
                      }}</a>
                    }
                    <button
                      (click)="deleting.set(section)"
                      class="danger"
                      type="button"
                    >
                      {{ 'resource.action.delete' | rokuT }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>

    @if (deleting(); as target) {
      <lib-confirm-dialog
        (confirm)="confirmDelete(target)"
        (dismiss)="deleting.set(null)"
        [bodyArgs]="{ name: nameOf(target) }"
        [busy]="removing()"
        bodyKey="catalog.chainSections.deleteBody"
        confirmKey="catalog.chainSections.deleteConfirm"
        headingKey="catalog.chainSections.deleteHeading"
      />
    }
  `,
  styles: `
    :host {
      display: block;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    .empty {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .failure {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius);
      background: var(--admin-danger-wash);
    }

    .scroll {
      inline-size: 100%;
      overflow-x: auto;
    }

    table {
      inline-size: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: var(--admin-space-2) var(--admin-space-3);
      border-block-end: 1px solid var(--admin-border);
      text-align: start;
      vertical-align: baseline;
    }

    thead th {
      font-size: 0.75rem;
      font-weight: 400;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .num {
      text-align: end;
      font-variant-numeric: tabular-nums;
    }

    .name {
      font-weight: 600;
    }

    .mono {
      font-family: ui-monospace, 'SFMono-Regular', 'Consolas', monospace;
      font-size: 0.8125rem;
    }

    .chip {
      display: inline-block;
      margin: 0 var(--admin-space-1) var(--admin-space-1) 0;
      padding: 0 var(--admin-space-2);
      border-radius: var(--admin-radius);
      background: var(--admin-surface);
      font-size: 0.8125rem;
      white-space: nowrap;
    }

    .chip.root {
      background: var(--admin-accent-wash);
      color: var(--admin-accent-on-wash);
    }

    .actions {
      display: flex;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: flex-end;
      white-space: nowrap;
    }

    a {
      color: var(--admin-accent);
    }

    a.button,
    button {
      min-block-size: 2.25rem;
      padding: var(--admin-space-1) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-surface-raised);
      font: inherit;
      color: var(--admin-ink);
      text-decoration: none;
      cursor: pointer;
    }

    button.danger {
      color: var(--admin-danger);
    }

    a:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    .visually-hidden {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainSections {
  private readonly _sections = inject(ShopSections);
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _references = inject(ResourceReferences);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _content = inject(ContentLocaleStore);

  /** The chain whose sections are drawn. */
  readonly supermarketId = input.required<string>();

  readonly sections = signal<readonly ShopSection[]>([]);
  readonly loading = signal(false);
  readonly errorKey = signal<string | null>(null);

  /** The section the operator asked to delete, while the dialog is open. */
  readonly deleting = signal<ShopSection | null>(null);
  readonly removing = signal(false);
  readonly deleteErrorKey = signal<string | null>(null);

  private readonly _categories = signal<ReadonlyMap<string, CoveredCategory>>(
    new Map()
  );
  private readonly _asked = new Set<string>();
  private _generation = 0;

  /** The create form, opened with this chain already chosen. */
  readonly newLink = computed(() => {
    const path = this._registry.pathOf('sections');
    return path === null ? null : [...path, 'new'];
  });

  constructor() {
    effect(() => {
      const id = this.supermarketId();
      untracked(() => void this._read(id));
    });
  }

  nameOf(section: ShopSection): string {
    return (
      localizedTextValue(section.name, this._content.order()) || section.slug
    );
  }

  /** The categories a section covers, named once the lookup answers. */
  covered(section: ShopSection): readonly CoveredCategory[] {
    const known = this._categories();
    return section.categoryIds.map(
      (id) => known.get(id) ?? { id, name: id, root: false }
    );
  }

  editLink(id: string): readonly string[] | null {
    const path = this._registry.pathOf('sections');
    return path === null ? null : [...path, id];
  }

  reload(): Promise<void> {
    return this._read(this.supermarketId());
  }

  async confirmDelete(section: ShopSection): Promise<void> {
    this.removing.set(true);
    this.deleteErrorKey.set(null);
    try {
      await this._gateways.for(sectionSource()).remove(section.id);
      this.deleting.set(null);
      await this.reload();
    } catch (error) {
      this.deleting.set(null);
      this.deleteErrorKey.set(panelErrorKey(error));
    } finally {
      this.removing.set(false);
    }
  }

  private async _read(supermarketId: string): Promise<void> {
    this._generation += 1;
    const generation = this._generation;
    this.loading.set(true);
    this.errorKey.set(null);

    try {
      const sections = await this._sections.chainSections(supermarketId);
      if (generation !== this._generation) {
        return;
      }
      this.sections.set(sections);
      this._nameCategories(sections.flatMap((section) => section.categoryIds));
    } catch (error) {
      if (generation === this._generation) {
        this.errorKey.set(panelErrorKey(error));
      }
    } finally {
      if (generation === this._generation) {
        this.loading.set(false);
      }
    }
  }

  private _nameCategories(ids: readonly string[]): void {
    for (const id of new Set(ids)) {
      if (this._asked.has(id)) {
        continue;
      }
      this._asked.add(id);
      this._references
        .resolve('categories', id)
        .then((option) => {
          if (option === null) {
            return;
          }
          const parent = option.row?.['parentId'];
          this._categories.update((held) =>
            new Map(held).set(id, {
              id,
              name: option.title,
              root: parent === null,
            })
          );
        })
        .catch(() => {
          // The id stays, which is what a category nobody can name shows.
        });
    }
  }
}
