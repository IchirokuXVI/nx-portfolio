import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_SERVICE,
  type CatalogServiceI,
  GroupMembers,
  GroupNames,
  ItemNames,
  LineStore,
  ListStore,
  ShoppingProfileStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  type CatalogItem,
  type CatalogSuggestion,
  inLocale,
  LINE_ITEM_SET_MAX,
  type LineProductsFullVm,
  productSuggestions,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
} from '@portfolio/velista/models';
import { PageNavigation, productPagePath } from '@portfolio/velista/platform';
import {
  CloseIcon,
  PageHeader,
  ProductIcon,
  SimilarProducts,
  StarFilledIcon,
  StarIcon,
  SuggestionList,
} from '@portfolio/velista/ui';
import { linePageStatus, loadLineContext } from '../line-page/line-context';
import { lineUrls } from '../line-page/line-urls';
import { selectAbilities } from '../select-list-state';
import { selectLineProducts } from './select-line-products';

/** Products of one line that share a product group. */
interface LineProductGroup {
  readonly groupId: string;
  readonly itemIds: readonly string[];
}

/** One "similar products" list on the page. */
export interface LineSimilarVm {
  readonly groupId: string;
  /** The line's products this list offers to replace. */
  readonly replaces: readonly string[];
  /** Every product on the line, none of which is offered again. */
  readonly excludeIds: readonly string[];
  readonly members: readonly CatalogItem[] | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly headingKey: string;
  readonly headingArgs: Record<string, unknown> | undefined;
}

/**
 * Where the products of a line are changed (velista `0135`, section 3).
 *
 * A page and not a sheet, because of the keyboard: a search field in a sheet
 * leaves a few rows above the keys. The cards of the line page carry no remove
 * and no add, and "Change" beside them opens this.
 *
 * ## What is on it
 *
 * One field that searches the catalog, **not focused on arrival**, so the
 * products are in sight first. Under it the products of the line, each with its
 * star (the favourite, section 3.1), its cross, and `Keep` on a product the
 * catalog put there (plan 0065). Typing replaces the list with catalog results.
 *
 * This is the search, the adopt and the remove that the line page had, moved
 * here whole. The rules they follow are theirs and did not change: the set is
 * unioned, the cap is checked before anything is sent, and provenance moves one
 * way.
 */
@Component({
  selector: 'lib-line-products-page',
  imports: [
    RokuTranslatorPipe,
    PageHeader,
    ProductIcon,
    StarIcon,
    StarFilledIcon,
    CloseIcon,
    SimilarProducts,
    SuggestionList,
  ],
  templateUrl: './line-products-page.html',
  styleUrl: './line-products-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineProductsPage {
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _itemNames = inject(ItemNames);
  private readonly _groupNames = inject(GroupNames);
  private readonly _groupMembers = inject(GroupMembers);
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _localeStore = inject(RokuLocaleStore);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _urls = lineUrls();

  /** A write to the product set is out. */
  readonly busy = signal(false);

  /** Why the last add was refused before it was sent, or null (plan 0065, 3.3). */
  readonly productsFull = signal<LineProductsFullVm | null>(null);

  /** What the field holds. Results replace the products from three characters. */
  readonly query = signal('');

  /** Products only, in the server's order among themselves. */
  readonly suggestions = signal<readonly CatalogSuggestion[]>([]);

  /** Pictures that failed to load, so the carton takes their place. */
  private readonly _broken = signal<ReadonlySet<string>>(new Set());

  private readonly _line = computed(() =>
    this._lines
      .linesIn(this._urls.listId())
      .find((line) => line.id === this._urls.lineId())
  );

  readonly status = computed(() =>
    linePageStatus(this._lines, this._urls.listId(), this._urls.lineId())
  );

  /** The line's product set, compared by value (see `LinePage`). */
  private readonly _itemIds = computed<readonly string[]>(
    () => this._line()?.itemIds ?? [],
    {
      equal: (a, b) =>
        a.length === b.length && a.every((itemId, i) => itemId === b[i]),
    }
  );

  /** `WRITE` on a line nobody approved yet, `MANAGE` on any. */
  private readonly _canEdit = computed(() => {
    const abilities = selectAbilities(
      this._lists
        .listsIn(this._urls.zoneId())
        .find((list) => list.id === this._urls.listId())?.myPermissions ?? []
    );
    return (
      abilities.canManage ||
      (abilities.canWrite && this._line()?.approvalStatus !== 'APPROVED')
    );
  });

  /** Whether the field has enough text to search with. */
  readonly searching = computed(
    () => this.query().trim().length >= SUGGEST_MIN_CHARS
  );

  readonly view = computed(() => {
    const line = this._line();
    const locale = this._localeStore.locale();
    this._translator.loaded();

    return selectLineProducts({
      line,
      itemNameOf: (itemId) => this._itemNames.nameOf(itemId),
      namesUnavailable: this._itemNames.anyFailed(line?.itemIds ?? []),
      groupNameOf: (groupId) => this._groupNames.nameOf(groupId),
      locale,
      canEdit: this._canEdit(),
      translate: (key, args) =>
        this._translator.t(key, undefined, locale, args),
    });
  });

  readonly title = computed(() => {
    const locale = this._localeStore.locale();
    this._translator.loaded();
    const name = this._line()?.content ?? '';
    return name === ''
      ? this._translator.t('list.products.titlePlain', undefined, locale)
      : this._translator.t('list.products.title', undefined, locale, { name });
  });

  /**
   * The line's products that belong to a product group, gathered by group. Read
   * off the catalog items `ItemNames` already holds, so it costs no request.
   */
  private readonly _grouped = computed<readonly LineProductGroup[]>(
    () => {
      const byGroup = new Map<string, string[]>();
      for (const itemId of this._itemIds()) {
        const groupId = this._itemNames.nameOf(itemId)?.productGroupId ?? null;
        if (groupId !== null) {
          byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), itemId]);
        }
      }
      return [...byGroup].map(([groupId, itemIds]) => ({ groupId, itemIds }));
    },
    { equal: sameGroups }
  );

  /**
   * "Similar products": one list for each group the line's products belong to.
   * A group is one product sold under several labels, so each row is a product
   * the line could hold instead.
   */
  readonly similar = computed<readonly LineSimilarVm[]>(() => {
    const grouped = this._grouped();
    const locale = this._localeStore.locale();
    const many = grouped.length > 1;

    return grouped.map(({ groupId, itemIds }) => {
      const entry = this._groupMembers.entry(groupId);
      const first = this._itemNames.nameOf(itemIds[0]);
      return {
        groupId,
        replaces: itemIds,
        excludeIds: this._itemIds(),
        members: entry?.status === 'ready' ? entry.members : null,
        loading: entry === null || entry.status === 'loading',
        failed: entry?.status === 'failed',
        headingKey: many ? 'catalog.similar.titleFor' : 'catalog.similar.title',
        headingArgs: many
          ? { name: first === null ? '' : catalogName(first.name, locale) }
          : undefined,
      };
    });
  });

  /** Two requests can answer out of order, so an older one must not win. */
  private _seq = 0;

  constructor() {
    loadLineContext(this._urls.zoneId, this._urls.listId);

    effect(() => {
      const itemIds = this._itemIds();
      untracked(() => void this._itemNames.ensure(itemIds));
    });

    // The name of the group this line follows, keyed on the binding.
    effect(() => {
      const productGroupId = this._line()?.productGroupId ?? null;
      if (productGroupId !== null) {
        untracked(() => void this._groupNames.ensure([productGroupId]));
      }
    });

    effect(() => {
      const groupIds = this._grouped().map((group) => group.groupId);
      if (groupIds.length > 0) {
        untracked(() => void this._groupMembers.ensure(groupIds));
      }
    });

    // Ask the catalog, at most once per beat of quiet.
    effect((onCleanup) => {
      const query = this.query().trim();

      if (query.length < SUGGEST_MIN_CHARS) {
        untracked(() => this.suggestions.set([]));
        return;
      }

      const timer = setTimeout(() => {
        const seq = (this._seq += 1);
        // Scoped to where the reader shops. Nothing passed when no profile has
        // resolved, which is the documented read for somebody who set none up.
        const profileId = this._profiles.selected()?.id;
        void this._catalog
          .suggest(query, profileId === undefined ? undefined : { profileId })
          .then((found) => {
            if (seq === this._seq) {
              this.suggestions.set(productSuggestions(found));
            }
          });
      }, SUGGEST_DEBOUNCE_MS);

      onCleanup(() => clearTimeout(timer));
    });
  }

  imageOf(src: string | null): string | null {
    return src !== null && !this._broken().has(src) ? src : null;
  }

  markBroken(src: string): void {
    this._broken.update((broken) => new Set([...broken, src]));
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.productsFull.set(null);
  }

  /** The profile is wanted only once somebody searches, so it is read on focus. */
  onFocus(): void {
    void this._profiles.load();
  }

  /**
   * Attach what was chosen. The set is unioned, and a product already on the line
   * is a no-op. The cap is the server's own expression, checked before anything
   * is sent (velista plan 0065, section 3.2).
   */
  async addProduct(suggestion: CatalogSuggestion): Promise<void> {
    const line = this._line();
    if (line === undefined || this.busy()) {
      return;
    }

    const chosen =
      suggestion.kind === 'group' ? suggestion.itemIds : [suggestion.item.id];
    const merged = [...new Set([...line.itemIds, ...chosen])];
    if (merged.length === line.itemIds.length) {
      this._clearSearch();
      return;
    }

    if (merged.length > Math.max(LINE_ITEM_SET_MAX, line.itemIds.length)) {
      this.productsFull.set(
        suggestion.kind === 'group'
          ? {
              key: 'list.products.full.group',
              args: {
                count: line.itemIds.length,
                cap: LINE_ITEM_SET_MAX,
                name: inLocale(
                  suggestion.group.name,
                  this._localeStore.locale()
                ),
                adds: merged.length - line.itemIds.length,
              },
            }
          : {
              key: 'list.products.full.one',
              args: { count: line.itemIds.length, cap: LINE_ITEM_SET_MAX },
            }
      );
      // The results stay: somebody told the line is full wants another product.
      return;
    }

    this.productsFull.set(null);
    this.busy.set(true);
    await this._lines.updateLine(line.id, { itemIds: merged });
    this.busy.set(false);
    this._clearSearch();
  }

  /** Keep a product the catalog put there: `adoptItemIds` and nothing else. */
  async adoptProduct(itemId: string): Promise<void> {
    const line = this._line();
    if (
      line === undefined ||
      this.busy() ||
      !line.groupItemIds.includes(itemId)
    ) {
      return;
    }

    this.productsFull.set(null);
    this.busy.set(true);
    await this._lines.updateLine(line.id, { adoptItemIds: [itemId] });
    this.busy.set(false);
  }

  /** Take one product off the line. Never refused by the cap. */
  async removeProduct(itemId: string): Promise<void> {
    const line = this._line();
    if (line === undefined || this.busy()) {
      return;
    }

    this.productsFull.set(null);
    this.busy.set(true);
    await this._lines.updateLine(line.id, {
      itemIds: line.itemIds.filter((id) => id !== itemId),
    });
    this.busy.set(false);
  }

  /** The star of a row (section 3.1): set, move or clear the favourite. */
  async toggleFavorite(itemId: string): Promise<void> {
    const line = this._line();
    if (line === undefined || this.busy()) {
      return;
    }

    this.busy.set(true);
    await this._lines.updateLine(line.id, {
      favoriteItemId: line.favoriteItemId === itemId ? null : itemId,
    });
    this.busy.set(false);
  }

  /**
   * A similar product was pressed. With the right to edit, the products of that
   * group on the line are replaced by the one chosen. Without it the row opens
   * the product's own page.
   */
  async pickSimilar(
    replaces: readonly string[],
    itemId: string
  ): Promise<void> {
    const line = this._line();
    if (line === undefined || this.busy()) {
      return;
    }

    if (!this._canEdit()) {
      await this._router.navigateByUrl(
        productPagePath(this._localeStore.locale(), this._basePath, itemId)
      );
      return;
    }

    const next = [
      ...new Set(
        line.itemIds.map((id) => (replaces.includes(id) ? itemId : id))
      ),
    ];
    if (
      next.length === line.itemIds.length &&
      next.every((id, i) => id === line.itemIds[i])
    ) {
      return;
    }

    this.productsFull.set(null);
    this.busy.set(true);
    await this._lines.updateLine(line.id, { itemIds: next });
    this.busy.set(false);
  }

  /** Back to the line, which is where this page is always opened from. */
  async back(): Promise<void> {
    await this._pages.back(this._urls.line());
  }

  private _clearSearch(): void {
    this.query.set('');
    this.suggestions.set([]);
    this.productsFull.set(null);
  }
}

function sameGroups(
  a: readonly LineProductGroup[],
  b: readonly LineProductGroup[]
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (group, i) =>
        group.groupId === b[i].groupId &&
        group.itemIds.length === b[i].itemIds.length &&
        group.itemIds.every((itemId, j) => itemId === b[i].itemIds[j])
    )
  );
}
