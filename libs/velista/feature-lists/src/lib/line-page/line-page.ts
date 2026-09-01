import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  CATALOG_SERVICE,
  ItemNames,
  LineStore,
  ListStore,
  MemberNames,
  SessionStore,
  ShoppingProfileStore,
  ZoneStore,
  type CatalogServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  type CatalogSuggestion,
} from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  zoneIdOf,
} from '@portfolio/velista/platform';
import { ChevronLeftIcon, SuggestionList } from '@portfolio/velista/ui';
import { selectLinePage } from './select-line-page';

/**
 * Everything the app knows about one line (velista plan 0043, section 5.3).
 *
 * ## Its own route, and why that is the point
 *
 * A page rather than a deeper sheet, so it can be linked to and reached from a search
 * later. The detail sheet answers the question you have standing in the kitchen; this
 * answers everything else, and the two are different screens because they are read at
 * different moments.
 *
 * ## Two histories, side by side and labelled
 *
 * "On this list" is every settlement of this line: one household's consumption. "**
 * Everywhere you shop**" is every settlement of this line's products, across the zones
 * the reader can see: theirs. They are separate because they answer different
 * questions, and a single merged number would be neither.
 *
 * The second is **absent rather than empty** on a line with no products, and that is
 * not a rendering nicety: it is keyed on the product set, so a free text line cannot
 * have one, and drawing it empty would tell somebody they have never bought this
 * anywhere when nobody has yet said what "this" is. Which is the argument for the
 * composer's suggestions, and the reason this page has a place to attach one.
 *
 * ## What it does not draw
 *
 * Prices, and where to buy it. The region exists and says so, because the backend's
 * backlog `0004` is what fills it and with one chain harvested it would show one price
 * at one shop (section 9).
 */
@Component({
  selector: 'lib-line-page',
  imports: [RokuTranslatorPipe, ChevronLeftIcon, SuggestionList],
  templateUrl: './line-page.html',
  styleUrl: './line-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinePage {
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _zones = inject(ZoneStore);
  private readonly _names = inject(MemberNames);
  private readonly _itemNames = inject(ItemNames);
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _localeStore = inject(RokuLocaleStore);
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  readonly busy = signal(false);

  /**
   * Both histories, each asked for on its own.
   *
   * Two effects rather than one, because they arrive independently and the page is
   * useful with either: the per line history needs only the line, and the cross list
   * one needs its products first. A page that waited for both would show nothing while
   * the half it already had sat ready.
   */
  private readonly _loadOwn = effect(() => {
    const lineId = this.lineId();
    untracked(() => void this._lines.loadSettlements(lineId));
  });

  private readonly _loadItems = effect(() => {
    const line = this._line();
    if (line !== undefined) {
      untracked(() => void this._lines.loadItemSettlements(line));
    }
  });

  /**
   * The product names, from the catalog (velista plan 0047, section 1).
   *
   * A third effect, keyed on the product set rather than on the line id, so a product
   * added or removed while the page is open resolves without either history being read
   * again. Nothing waits for it: the chips draw with no names until it lands.
   */
  private readonly _loadNames = effect(() => {
    const itemIds = this._line()?.itemIds ?? [];
    untracked(() => void this._itemNames.ensure(itemIds));
  });

  private readonly _line = computed(() =>
    this._lines.linesIn(this.listId()).find((line) => line.id === this.lineId())
  );

  private readonly _permissions = computed(
    () =>
      this._lists
        .listsIn(this.zoneId())
        .find((list) => list.id === this.listId())?.myPermissions ?? []
  );

  readonly page = computed(() => {
    const line = this._line();
    const zoneId = this.zoneId();

    return selectLinePage({
      line,
      list: this._lists
        .listsIn(zoneId)
        .find((list) => list.id === this.listId()),
      zoneName: this._zones.zoneById(zoneId)?.name ?? null,
      settlements: this._lines.settlementsOf(this.lineId()),
      itemSettlements: this._lines.itemSettlementsOf(this.lineId()),
      // The catalog, through `ItemNames`, and never the fixture in `catalog-memory`
      // this used to read (section 1). Every one of its ids missed against a real
      // catalog, so this page said a line carrying products carried none.
      itemNameOf: (itemId) => this._itemNames.nameOf(itemId),
      namesUnavailable: this._itemNames.anyFailed(line?.itemIds ?? []),
      nameOf: (userId) => this._names.nameOf(zoneId, userId),
      listNameOf: (listId) => this._listNameOf(listId),
      callerUserId: this._session.userId(),
      locale: this._localeStore.locale(),
      // **Null, and not a derivation** (section 5). There is no endpoint that answers
      // "which of my lists carry this item", and the answer this page used to compute
      // from whatever the session had loaded under reported by construction, so an
      // empty one read as "no other list has this" when the truth was "nobody asked".
      // Backend plan 0053 section 3 adds the query; this is null until it lands.
      alsoOn: null,
      hasMoreSettlements: this._lines.hasMoreSettlements(this.lineId()),
      hasMoreItemSettlements: this._lines.hasMoreItemSettlements(this.lineId()),
      // `WRITE` on an unapproved line, `MANAGE` on anything, which is the same rule
      // the edit sheet follows: a writer whose line has been agreed to cannot quietly
      // change what was agreed to (backend plan 0036, section 4.1).
      canEdit: this._canEdit(),
      canDelete: this._canEdit(),
      busy: this.busy(),
    });
  });

  private _canEdit(): boolean {
    const permissions = this._permissions();
    const line = this._line();
    return (
      permissions.includes('MANAGE') ||
      (permissions.includes('WRITE') && line?.approvalStatus !== 'APPROVED')
    );
  }

  /**
   * Which list a settlement was on, for the cross list section.
   *
   * Searched across every zone the store holds, because a settlement in that section
   * can come from any of them: that is what makes it the reader's history rather than
   * this household's. Null for a list whose name is not cached, which the row draws as
   * nothing rather than as an id.
   */
  private _listNameOf(listId: string): string | null {
    for (const zone of this._zones.myZones()) {
      const found = this._lists
        .listsIn(zone.id)
        .find((list) => list.id === listId);
      if (found !== undefined) {
        return found.name;
      }
    }
    return null;
  }

  /**
   * The next page of one history, appended (section 4).
   *
   * Two methods rather than one taking a scope, because they are two different reads:
   * the first is one line's, the second is a union over the line's products with a
   * cursor each. The store holds both, and each is refiltered by the caller's read
   * access at the moment it is asked for.
   */
  async moreThisList(): Promise<void> {
    await this._lines.loadMoreSettlements(this.lineId());
  }

  async moreEverywhere(): Promise<void> {
    const line = this._line();
    if (line !== undefined) {
      await this._lines.loadMoreItemSettlements(line);
    }
  }

  /**
   * The search that attaches a product to this line (section 2).
   *
   * `0043` section 5.3 asked for it and the page shipped a static chip instead, which
   * drew the affordance and then declined the gesture. A line reached from this page is
   * frequently a line somebody is correcting, and sending them back to the list page's
   * composer to add a product to a line they are looking at is the long way round.
   *
   * The **composer's own list component**, not a second one, so the ranking rules have
   * one place to live. What differs is the free text row: the composer offers it,
   * because a line is free text first, and this does not, because attaching a catalog
   * product that is not in the catalog is not a thing.
   */
  readonly searching = signal(false);
  readonly suggestions = signal<readonly CatalogSuggestion[]>([]);

  private readonly _query = signal('');

  onQuery(event: Event): void {
    this._query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Ask the catalog, at most once per {@link SUGGEST_DEBOUNCE_MS} of quiet.
   *
   * The debounce and the sequence number are the list page's, for its reasons: two
   * requests can be in flight when somebody types through the beat and they can answer
   * out of order, so an older answer must not replace a newer one, and comparing the
   * query is not enough because the same text can be typed twice.
   */
  private _seq = 0;

  private readonly _suggestEffect = effect((onCleanup) => {
    const query = this._query().trim();

    if (query.length < SUGGEST_MIN_CHARS) {
      untracked(() => this.suggestions.set([]));
      return;
    }

    const timer = setTimeout(() => {
      const seq = (this._seq += 1);
      // Scoped to where the reader shops (section 3), from the same store the profiles
      // page writes. Nothing passed when no profile has resolved, which is the
      // documented behaviour for somebody who has set none up.
      const profileId = this._profiles.selected()?.id;
      void this._catalog
        .suggest(query, profileId === undefined ? undefined : { profileId })
        .then((found) => {
          if (seq === this._seq) {
            this.suggestions.set(found);
          }
        });
    }, SUGGEST_DEBOUNCE_MS);

    onCleanup(() => clearTimeout(timer));
  });

  /**
   * Open the search, and make sure a profile has been read.
   *
   * Loaded here rather than in the constructor, because this page is opened far more
   * often than a product is added to a line, and the profile is only wanted when one
   * is. The store is app scoped, so somebody who has already opened the profiles page
   * or the generation sheet pays nothing.
   */
  startAdding(): void {
    this.searching.set(true);
    void this._profiles.load();
  }

  /** Close it, and clear the words, so reopening does not offer yesterday's matches. */
  stopAdding(): void {
    this.searching.set(false);
    this._query.set('');
    this.suggestions.set([]);
  }

  /**
   * Attach what was chosen.
   *
   * A group attaches its members, an item attaches the one, which is exactly what the
   * composer does with the same row: choosing "milk" gives the household every milk to
   * trim down, and that trimming is what this page's chips are for.
   *
   * The set is **unioned** rather than replaced, and a product already on the line is a
   * no-op rather than a duplicate: the line's set is a set.
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
      this.stopAdding();
      return;
    }

    this.busy.set(true);
    await this._lines.updateLine(line.id, { itemIds: merged });
    this.busy.set(false);
    this.stopAdding();
  }

  /** Take one product off the line. An ordinary edit: the set is rewritten whole. */
  async removeProduct(itemId: string): Promise<void> {
    const line = this._line();
    if (line === undefined || this.busy()) {
      return;
    }

    this.busy.set(true);
    await this._lines.updateLine(line.id, {
      itemIds: line.itemIds.filter((id) => id !== itemId),
    });
    this.busy.set(false);
  }

  /** Delete, behind a confirmation, which is the only thing that discards a history. */
  async confirmDelete(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(
        this._localeStore.locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId(),
        'lines',
        this.lineId(),
        'confirm',
        'delete'
      )
    );
  }

  async back(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(
        this._localeStore.locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId()
      )
    );
  }
}
