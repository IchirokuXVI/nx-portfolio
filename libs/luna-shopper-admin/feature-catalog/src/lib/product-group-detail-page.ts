import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  type OnDestroy,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  RESOURCE_GATEWAYS,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  RESOURCE_ID_PARAM,
  ResourceFormPage,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  localizedTextValue,
  REFERENCE_NONE,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { itemSource, productGroupSource } from './catalog-sources';
import {
  GroupAssignReview,
  type GroupCandidate,
  type GroupTarget,
} from './group-assign-review';
import { GroupNames } from './group-names';

/** How long typing settles before a search goes out. */
const SEARCH_DELAY_MS = 250;

/** How many products one search shows. */
const SEARCH_PAGE_SIZE = 25;

/**
 * One product group: the form that edits it, and "Add items" under it (admin
 * plan 0035, section 2).
 *
 * **The group half is the generic detail view**, embedded as the brand screen
 * embeds it, so editing a group is exactly what it was. The block underneath is
 * what a descriptor cannot say: find products, tick them, and move them into
 * this group through one reviewed request.
 *
 * The search opens on the products in no group, because those are the ones
 * curation has not reached and the reason somebody opens a group to add to it.
 * Typing searches every product, and a product in another group says which,
 * so moving it is a decision made while seeing where it is now.
 */
@Component({
  selector: 'lib-product-group-detail-page',
  imports: [ResourceFormPage, RokuTranslatorPipe, GroupAssignReview],
  template: `
    <lib-resource-form-page />

    <section
      [attr.aria-label]="'catalog.productGroups.addItems.heading' | rokuT"
      class="panel"
      data-add-items
    >
      <h2>{{ 'catalog.productGroups.addItems.heading' | rokuT }}</h2>

      @if (!adding()) {
        <p class="muted">{{ 'catalog.productGroups.addItems.lead' | rokuT }}</p>
        <button (click)="startAdding()" type="button" data-add-items-open>
          {{ 'catalog.productGroups.addItems.open' | rokuT }}
        </button>
      } @else if (reviewing(); as target) {
        <lib-group-assign-review
          (cancelled)="backToPicking()"
          (closed)="finish($event)"
          [candidates]="pickedList()"
          [group]="target"
        />
      } @else {
        <label class="search">
          <span>{{ 'catalog.productGroups.addItems.search' | rokuT }}</span>
          <input
            (input)="onSearch($event)"
            [value]="query()"
            autocomplete="off"
            type="search"
            data-item-search
          />
        </label>
        <p class="muted">
          {{
            (query().trim() === ''
              ? 'catalog.productGroups.addItems.showingUngrouped'
              : 'catalog.productGroups.addItems.showingMatches'
            ) | rokuT
          }}
        </p>

        @if (searching()) {
          <p class="state">{{ 'resource.list.loading' | rokuT }}</p>
        } @else if (searchErrorKey(); as key) {
          <p class="failure" role="alert">{{ key | rokuT }}</p>
        } @else if (found().length === 0) {
          <p class="state">{{ 'resource.list.noMatch' | rokuT }}</p>
        } @else {
          <ul class="found">
            @for (candidate of found(); track candidate.id) {
              <li [class.picked]="isPicked(candidate.id)">
                <label>
                  <input
                    (change)="toggle(candidate)"
                    [checked]="isPicked(candidate.id)"
                    [disabled]="candidate.currentGroupId === groupId"
                    type="checkbox"
                    data-pick-item
                  />
                  <span class="title">{{ candidate.title }}</span>
                  <span class="muted">
                    {{
                      (candidate.currentGroupId === groupId
                        ? 'catalog.productGroups.addItems.inThisGroup'
                        : candidate.currentGroupId === null
                          ? 'catalog.productGroups.addItems.inNoGroup'
                          : 'catalog.productGroups.addItems.inGroup'
                      )
                        | rokuT
                          : {
                              group:
                                candidate.currentGroupName ??
                                candidate.currentGroupId,
                            }
                    }}
                  </span>
                </label>
              </li>
            }
          </ul>
        }

        <div class="controls">
          <p aria-live="polite" class="count">
            {{
              'catalog.productGroups.addItems.selected'
                | rokuT: { count: pickedList().length }
            }}
          </p>
          <button
            (click)="review()"
            [disabled]="pickedList().length === 0 || target() === null"
            class="primary"
            type="button"
            data-add-review
          >
            {{
              'catalog.productGroups.addItems.review'
                | rokuT: { count: pickedList().length }
            }}
          </button>
          <button (click)="stopAdding()" type="button" data-add-cancel>
            {{ 'resource.action.cancel' | rokuT }}
          </button>
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-6);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      max-inline-size: 48rem;
      padding-block-start: var(--admin-space-4);
      border-block-start: 1px solid var(--admin-border);
    }

    h2 {
      font-size: 1.125rem;
      font-weight: 700;
    }

    .muted,
    .state {
      color: var(--admin-ink-muted);
    }

    .search {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      inline-size: 100%;
      max-inline-size: 24rem;
    }

    .search > span {
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    input[type='search'] {
      min-block-size: 2.75rem;
      padding: var(--admin-space-2) var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
      font: inherit;
      font-size: 1rem;
      color: var(--admin-ink);
    }

    .found {
      display: flex;
      flex-direction: column;
      inline-size: 100%;
      list-style: none;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .found li + li {
      border-block-start: 1px solid var(--admin-border);
    }

    .found li.picked {
      background: var(--admin-accent-wash);
    }

    .found label {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      align-items: center;
      padding: var(--admin-space-3);
      cursor: pointer;
    }

    .found .title {
      font-weight: 600;
    }

    input[type='checkbox'] {
      inline-size: 1.25rem;
      block-size: 1.25rem;
      accent-color: var(--admin-accent);
    }

    .failure {
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
      align-items: center;
    }

    .count {
      font-variant-numeric: tabular-nums;
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

    button:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductGroupDetailPage implements OnDestroy {
  private readonly _route = inject(ActivatedRoute);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _items =
    this._gateways.for<Wire.CatalogItemView>(itemSource());
  private readonly _groups =
    this._gateways.for<Wire.CatalogProductGroupView>(productGroupSource());
  private readonly _names = new GroupNames(inject(ResourceReferences));

  readonly groupId = this._route.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? '';

  readonly adding = signal(false);
  readonly query = signal('');
  readonly searching = signal(false);
  private readonly _searchError = signal<GatewayError | null>(null);
  readonly searchErrorKey = computed(() =>
    gatewayErrorKey(this._searchError())
  );
  private readonly _found = signal<readonly Wire.CatalogItemView[]>([]);

  /** The group itself, read when "Add items" opens. */
  readonly target = signal<GroupTarget | null>(null);

  /** The ticked products, by id, in the order they were ticked. */
  private readonly _picked = signal<ReadonlyMap<string, GroupCandidate>>(
    new Map()
  );
  readonly pickedList = computed(() => [...this._picked().values()]);

  /** The group being reviewed into, or `null` while ticking. */
  readonly reviewing = signal<GroupTarget | null>(null);

  readonly found = computed<readonly GroupCandidate[]>(() => {
    const names = this._names.names();
    return this._found().map((item) => this._candidate(item, names));
  });

  private _timer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
  }

  isPicked(id: string): boolean {
    return this._picked().has(id);
  }

  startAdding(): void {
    this.adding.set(true);
    void this._readTarget();
    void this._search();
    this._focusLater('[data-item-search]');
  }

  stopAdding(): void {
    this.adding.set(false);
    this.reviewing.set(null);
    this._picked.set(new Map());
    this.query.set('');
    this._focusLater('[data-add-items-open]');
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => {
      this._timer = null;
      void this._search();
    }, SEARCH_DELAY_MS);
  }

  toggle(candidate: GroupCandidate): void {
    const next = new Map(this._picked());
    if (next.has(candidate.id)) {
      next.delete(candidate.id);
    } else if (candidate.currentGroupId !== this.groupId) {
      next.set(candidate.id, candidate);
    }
    this._picked.set(next);
  }

  /** Open the review. Nothing is sent until its own button is pressed. */
  review(): void {
    const target = this.target();
    if (target === null || this._picked().size === 0) {
      return;
    }
    this.reviewing.set(target);
    this._focusLater('[data-assign-review]');
  }

  backToPicking(): void {
    this.reviewing.set(null);
    this._focusLater('[data-add-review]');
  }

  /**
   * The answer has been read.
   *
   * Moved products leave the selection and the search is read again, so what
   * is listed is what is true now. A refused request keeps every tick: the
   * answer said which product stopped it, and the rest are still wanted.
   */
  finish(applied: boolean): void {
    this.reviewing.set(null);
    if (applied) {
      this._picked.set(new Map());
      void this._search();
    }
    this._focusLater('[data-item-search]');
  }

  private async _readTarget(): Promise<void> {
    try {
      const group = await this._groups.read(this.groupId);
      this.target.set({
        id: group.id,
        name: localizedTextValue(group.name, this._content.order()),
      });
    } catch (error) {
      this._searchError.set(error as GatewayError);
    }
  }

  private async _search(): Promise<void> {
    const term = this.query().trim();
    this.searching.set(true);
    this._searchError.set(null);
    try {
      const page = await this._items.list({
        limit: SEARCH_PAGE_SIZE,
        filters:
          term === '' ? { productGroupId: REFERENCE_NONE } : { query: term },
      });
      this._found.set(page.items);
      void this._names.resolve(
        page.items.map((item) => item.productGroupId ?? null)
      );
    } catch (error) {
      this._searchError.set(error as GatewayError);
    } finally {
      this.searching.set(false);
    }
  }

  private _candidate(
    item: Wire.CatalogItemView,
    names: ReadonlyMap<string, string>
  ): GroupCandidate {
    const groupId = item.productGroupId ?? null;
    return {
      id: item.id,
      title: localizedTextValue(item.name, this._content.order()),
      currentGroupId: groupId,
      currentGroupName: groupId === null ? null : (names.get(groupId) ?? null),
    };
  }

  private _focusLater(selector: string): void {
    afterNextRender(
      () => {
        this._host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this._injector }
    );
  }
}
