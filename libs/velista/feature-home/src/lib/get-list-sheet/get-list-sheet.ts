import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  GeneratedListStore,
  LIST_SERVICE,
  SHOPPING_PROFILE_SERVICE,
  ShoppingProfileStore,
  ZoneStore,
  type ListServiceI,
  type ShoppingProfileServiceI,
} from '@portfolio/velista/data-access';
import { BASKET_PATHS } from '@portfolio/velista/feature-shopping-lists';
import {
  APP_BASE_PATH,
  formatGeneratedDate,
  GENERATED_LIST_NAME_MAX_LENGTH,
  type GeneratedListSource,
  type ProfileGenerationScope,
} from '@portfolio/velista/models';
import { appPath, SheetNavigation } from '@portfolio/velista/platform';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SheetShell,
  SpinnerIcon,
} from '@portfolio/velista/ui';

/**
 * What a group contributes to the run.
 *
 * `all` is not "every list I can see today": it is what the backend stores as `ALL`,
 * meaning every list in the group the caller may write to, **including ones made
 * later** (backend `0049` section 1). That is a different promise from naming today's
 * list ids, and it is the one worth keeping, since a household that starts a new list
 * next week should not have to come back here.
 *
 * So it is a mode rather than a set of ticks, and the difference survives to the wire:
 * `all` sends `{ zoneId, listId: null }` and `some` sends one entry per list.
 */
type ZoneSelection =
  | { readonly mode: 'all' }
  | { readonly mode: 'some'; readonly listIds: ReadonlySet<string> };

/** A group's writable lists, once somebody has expanded it. */
interface LoadedLists {
  readonly state: 'loading' | 'loaded' | 'failed';
  readonly lists: readonly { readonly id: string; readonly name: string }[];
}

/** How many lists one page asks for. The gateway's `MAX_PAGE_SIZE` is the ceiling. */
const LIST_PAGE_SIZE = 100;

/**
 * A hard stop on the cursor loop, matching `listSupermarkets`' own.
 *
 * Ten thousand writable lists in one group is not a household, so reaching this means a
 * server answering with the cursor it was handed rather than a person with a lot of
 * lists. A tree that is short by a page is a better failure than a phone spinning
 * requests forever while somebody waits to press Generate.
 */
const MAX_LIST_PAGES = 100;

/**
 * Get shopping list: name it, say where it draws from, and generate it (plan 0045,
 * section 3.4).
 *
 * The container, and the only thing here that touches a store (rule D1).
 *
 * ## Why the groups load and the lists do not
 *
 * The tree starts with every group checked whole and **no list request at all**, which
 * is both the cheapest first frame and the correct default: `ALL` per group is what a
 * fresh profile stores, and it is what somebody who opens this sheet and presses
 * Generate means. A group's lists are fetched only when it is expanded, which is the
 * one moment they are needed, because narrowing is the minority act.
 *
 * `ZoneStore.myZones()` cannot supply them: its `lists` are a **preview** of at most
 * three, and they carry no permission, so a tree built from them would silently hide a
 * group's fourth list and would offer lists the caller may only read. `listLists`
 * answers `myPermissions` per list, which is what section 3.4's "only lists where the
 * caller holds `WRITE` appear at all" actually needs.
 *
 * ## The prechecked scope, and where it comes from
 *
 * Section 3.4 asks for the sources to be prechecked from the profile's stored generation
 * scope, and velista `0049` section 3 is how that became possible without reintroducing
 * the hazard plan 0046 was avoiding. The scope is **read through its own call and held
 * on its own** (`readGenerationScope`), never merged into the `ShoppingProfile` the
 * profiles page edits and saves: `PATCH` treats a present collection as a full
 * replacement, so a field riding along on the object that page saves is a field that
 * will one day be sent back empty and erase somebody's stored scope. Splitting the read
 * makes that impossible rather than something to be careful about.
 *
 * Where the profile stores `SELECTED`, the tree opens on exactly those sources; where it
 * stores `ALL`, or stores nothing, or the read fails, the tree prechecks every group
 * whole, which is today's behaviour and the right default for somebody who has never
 * narrowed anything. Changing the profile in the chooser re-reads it, because the ticks
 * are that profile's and not the sheet's.
 *
 * Whatever it opens on, Generate sends **explicit** sources for what is ticked rather
 * than omitting them and letting the server fall back to the same stored scope. What is
 * on screen is what is used: a tree showing everything ticked while the server quietly
 * drew from three lists would be worse than either behaviour on its own.
 */
@Component({
  selector: 'lib-get-list-sheet',
  imports: [
    RokuTranslatorPipe,
    CheckIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    SheetShell,
    SpinnerIcon,
  ],
  templateUrl: './get-list-sheet.html',
  styleUrl: './get-list-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GetListSheet {
  private readonly _zones = inject(ZoneStore);
  private readonly _generated = inject(GeneratedListStore);
  private readonly _profiles = inject(ShoppingProfileStore);
  /**
   * The profile service directly, for the generation scope and nothing else.
   *
   * Not through `ShoppingProfileStore`, deliberately (plan 0049, section 3). That store
   * holds the `ShoppingProfile` the profiles page edits and saves, and the whole point
   * of this read is that the scope never lands on that object.
   */
  private readonly _profileService = inject<ShoppingProfileServiceI>(
    SHOPPING_PROFILE_SERVICE
  );
  private readonly _lists = inject<ListServiceI>(LIST_SERVICE);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _route = inject(ActivatedRoute);

  /**
   * The page this sheet is drawn over, named by the route rather than worked out from
   * the URL.
   *
   * This sheet exists twice, once over the dashboard and once over the history, and
   * after dismissal somebody belongs back on whichever they opened it from. Route data
   * makes that a declaration in the one table instead of string surgery on a URL, and
   * it is also right for a deep link, where there is no history entry to go back to.
   * Read from the snapshot because a sheet is created when its route activates and
   * destroyed when it deactivates, so there is no later value to miss.
   *
   * The default matches the route that has always existed, so a sheet route added
   * without the data behaves as the dashboard's rather than throwing.
   */
  private readonly _returnTo: 'home' | 'shopping-lists' =
    this._route.snapshot.data['returnTo'] === 'shopping-lists'
      ? 'shopping-lists'
      : 'home';

  /**
   * Whether to offer the way to the history.
   *
   * Section 3.1 puts it here because the dashboard's own History link lives in the
   * shopping list card, which goes away when every basket is finished; without this
   * one such a person would have no route to their history at all. None of that
   * applies when the history is the page underneath, and a control that leads to the
   * screen it is already on is worse than no control.
   */
  readonly showHistory = this._returnTo !== 'shopping-lists';

  readonly maxLength = GENERATED_LIST_NAME_MAX_LENGTH;

  readonly name = signal('');
  readonly submitting = signal(false);

  /** The key of the message under the submit, or null. Copy, never a server string. */
  readonly errorKey = signal<string | null>(null);

  /** Which groups are expanded. Ids, so a reload of the zones does not collapse them. */
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  private readonly _selection = signal<ReadonlyMap<string, ZoneSelection>>(
    new Map()
  );

  /**
   * What a group with no entry in {@link _selection} means.
   *
   * `all` while nothing has narrowed the sheet, which is the sheet's whole default and
   * the reason the first frame costs no list request: every group is ticked without a
   * map entry per group. A stored `SELECTED` scope flips it to `none`, so the groups
   * that scope did not mention contribute nothing.
   *
   * A **mode rather than an enumeration of the unmentioned groups**, because the prefill
   * runs off the profile read and the zones arrive from a different one: enumerating
   * them would miss whichever groups had not landed yet, and those would keep the `all`
   * default and draw from a household the person had deliberately left out.
   */
  private readonly _unselectedMode = signal<'all' | 'none'>('all');

  /** What a group with no explicit selection resolves to, as a selection. */
  private _selectionOf(zoneId: string): ZoneSelection {
    return (
      this._selection().get(zoneId) ??
      (this._unselectedMode() === 'all'
        ? { mode: 'all' }
        : { mode: 'some', listIds: new Set() })
    );
  }

  private readonly _loaded = signal<ReadonlyMap<string, LoadedLists>>(
    new Map()
  );

  /**
   * The key that makes a double tap produce one basket (backend `0050` section 4).
   *
   * Minted **once per opening of the sheet** and not per press, which is the whole
   * point: a key made at submit time would be a different key on the second tap and
   * would compose a second basket, which is exactly the thing it exists to prevent. It
   * is not reset after a failure either, so a retry of a request that actually reached
   * the server returns the basket it already made rather than a duplicate.
   */
  private readonly _idempotencyKey = crypto.randomUUID();

  /** Every group the caller is an approved member of, in the dashboard's order. */
  readonly zones = computed(() =>
    this._zones.myZones().filter((zone) => zone.myStatus === 'APPROVED')
  );

  /**
   * Whether there is anywhere at all to draw from.
   *
   * Belonging to no group is the one case this screen can be sure of **on open**,
   * without a `listLists` per group, and it stays the only one: section 3.4's sentence
   * has to be there before anybody has expanded anything.
   */
  readonly noSources = computed(() => this.zones().length === 0);

  /**
   * Whether somebody in groups turns out to be able to write in none of them.
   *
   * The other half of "no sources" (plan 0049, section 4). This screen cannot know it
   * up front: writability is per list and comes from `listLists`, so asking on open
   * would be a request per group to answer a question that is almost always no. So the
   * sheet **resolves it as it expands**, and the moment every group somebody has opened
   * has come back with nothing writable in it, it says the same sentence it would have
   * said up front rather than leaving them to infer it from an empty expansion.
   *
   * Deliberately not "some group is empty": one empty group among four is ordinary and
   * says nothing about whether the run can draw from anywhere. This asks whether every
   * group that has answered is empty, and requires at least one to have, so it is
   * silent while the first is still loading.
   */
  readonly noWritableSources = computed(() => {
    if (this.noSources()) {
      // Already covered by the sentence above, and saying it twice is worse than once.
      return false;
    }

    const loaded = [...this._loaded().values()].filter(
      (group) => group.state === 'loaded'
    );

    return (
      loaded.length > 0 && loaded.every((group) => group.lists.length === 0)
    );
  });

  readonly profiles = this._profiles.profiles;

  /** The profile the run uses. Null while the profiles have not arrived. */
  readonly selectedProfileId = signal<string | null>(null);

  /**
   * The chooser is drawn only for somebody with more than one profile.
   *
   * The absence rule (plan 0046, section 3.2, and `0030` before it): a chooser with one
   * choice is furniture. With one profile the run still uses it, because the request
   * names it either way.
   */
  readonly showProfiles = computed(() => this.profiles().length > 1);

  /** What Generate will send. Empty means nothing is ticked and the submit is off. */
  readonly sources = computed<readonly GeneratedListSource[]>(() => {
    const sources: GeneratedListSource[] = [];

    for (const zone of this.zones()) {
      const chosen = this._selectionOf(zone.id);
      if (chosen.mode === 'all') {
        sources.push({ zoneId: zone.id, listId: null });
        continue;
      }

      for (const listId of chosen.listIds) {
        sources.push({ zoneId: zone.id, listId });
      }
    }

    return sources;
  });

  readonly canSubmit = computed(
    () => !this.submitting() && this.sources().length > 0
  );

  /** The date an unnamed list will show, which is what the name field suggests. */
  readonly namePlaceholder = computed(() =>
    formatGeneratedDate(new Date(), this._locale())
  );

  constructor() {
    void this._zones.load();
    // The profiles, for the one row that names which one the run uses. Idempotent, and
    // usually already in hand: the store is app scoped, so a person who has opened the
    // profiles page in this session pays nothing here.
    void this._profiles.load().then(() => {
      const fallback =
        this.profiles().find((profile) => profile.isDefault) ??
        this.profiles()[0];
      if (this.selectedProfileId() === null && fallback !== undefined) {
        this.selectedProfileId.set(fallback.id);
        void this._prefillFrom(fallback.id);
      }
    });
  }

  /**
   * Open the tree on what this profile stores (plan 0049, section 3).
   *
   * Its own read, through its own service method, into a type the profiles page never
   * touches. See the class docs for why that separation is the feature rather than
   * ceremony.
   *
   * **Anything other than a `SELECTED` scope leaves the tree alone**, which means every
   * group ticked whole. `ALL`, a profile with no stored scope, a stale profile id and a
   * read that failed all land there, and they should: the fallback is what somebody who
   * has never narrowed anything means, so being wrong costs a tick they untick rather
   * than a basket drawn from nothing.
   *
   * A `SELECTED` scope with a `null` list id is the **whole group including lists made
   * later**, which is the `all` mode here and not an enumeration of today's ids. That
   * distinction is the one thing a prefill could quietly destroy: reading it as a set of
   * ticks would send today's lists and stop including new ones, from an interaction that
   * looks like it restored what was stored.
   */
  private async _prefillFrom(profileId: string): Promise<void> {
    let stored: ProfileGenerationScope | null = null;
    try {
      stored = await this._profileService.readGenerationScope(profileId);
    } catch {
      // Left null. The tree keeps every group ticked, which is the safe default.
      return;
    }

    // A profile that has been changed underneath this call is not this answer's to
    // fill in: somebody switched the chooser while it was in flight.
    if (stored === null || this.selectedProfileId() !== profileId) {
      return;
    }

    if (stored.scope !== 'SELECTED') {
      this._unselectedMode.set('all');
      this._selection.set(new Map());
      return;
    }

    const selection = new Map<string, ZoneSelection>();
    for (const source of stored.sources) {
      if (source.listId === null) {
        selection.set(source.zoneId, { mode: 'all' });
        continue;
      }

      const held = selection.get(source.zoneId);
      // A group already on `all` stays there: a stored scope naming both the whole
      // group and one of its lists means the whole group, and the wider of the two is
      // the one that keeps the "including lists made later" promise.
      if (held?.mode === 'all') {
        continue;
      }

      selection.set(source.zoneId, {
        mode: 'some',
        listIds: new Set([...(held?.listIds ?? []), source.listId]),
      });
    }

    // A group the stored scope does not mention contributes **nothing**, so the
    // fallback for a group with no entry flips with the prefill rather than the
    // unmentioned groups being enumerated here. Enumerating them would race the zone
    // read: this runs off the profile read, and a group that had not arrived yet would
    // be missed and quietly keep the `all` default, drawing from a household the
    // stored scope had left out.
    this._unselectedMode.set('none');
    this._selection.set(selection);
  }

  /** How a group's own checkbox draws: ticked, empty, or the dash between them. */
  zoneState(zoneId: string): 'all' | 'none' | 'some' {
    const chosen = this._selectionOf(zoneId);
    if (chosen.mode === 'all') {
      return 'all';
    }
    return chosen.listIds.size === 0 ? 'none' : 'some';
  }

  listChecked(zoneId: string, listId: string): boolean {
    const chosen = this._selectionOf(zoneId);
    return chosen.mode === 'all' ? true : chosen.listIds.has(listId);
  }

  listsOf(zoneId: string): LoadedLists | undefined {
    return this._loaded().get(zoneId);
  }

  isExpanded(zoneId: string): boolean {
    return this.expanded().has(zoneId);
  }

  /** Expand or collapse a group, fetching its writable lists the first time. */
  toggleExpanded(zoneId: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(zoneId)) {
        next.delete(zoneId);
      } else {
        next.add(zoneId);
      }
      return next;
    });

    if (this.isExpanded(zoneId) && this._loaded().get(zoneId) === undefined) {
      void this._loadLists(zoneId);
    }
  }

  /**
   * Tick or untick a whole group.
   *
   * Ticking returns it to `all`, and that is deliberate rather than a shortcut: a group
   * whose lists were individually re-ticked one by one would send today's ids and stop
   * including lists made later, which is a promise quietly broken by an interaction
   * that looks like it restored the previous state.
   */
  toggleZone(zoneId: string): void {
    const next = this.zoneState(zoneId) === 'none' ? 'all' : 'none';
    this._selection.update((current) => {
      const map = new Map(current);
      map.set(
        zoneId,
        next === 'all' ? { mode: 'all' } : { mode: 'some', listIds: new Set() }
      );
      return map;
    });
  }

  /**
   * Tick or untick one list.
   *
   * Unticking a list inside a group that is on `all` converts it to the explicit set of
   * everything else, which needs the group's lists to be loaded. They always are: this
   * is only reachable from an expanded group, and expanding is what loads them.
   */
  toggleList(zoneId: string, listId: string): void {
    const loaded = this._loaded().get(zoneId);
    if (loaded === undefined || loaded.state !== 'loaded') {
      return;
    }

    const chosen = this._selectionOf(zoneId);
    const current =
      chosen.mode === 'all'
        ? new Set(loaded.lists.map((list) => list.id))
        : new Set(chosen.listIds);

    if (current.has(listId)) {
      current.delete(listId);
    } else {
      current.add(listId);
    }

    this._selection.update((selection) => {
      const map = new Map(selection);
      // Everything ticked again is `all`, so the "including lists made later" promise
      // comes back rather than being lost to a round trip through the ticks.
      map.set(
        zoneId,
        current.size === loaded.lists.length
          ? { mode: 'all' }
          : { mode: 'some', listIds: current }
      );
      return map;
    });
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.errorKey.set(null);

    try {
      const typed = this.name().trim();
      const profileId = this.selectedProfileId();
      const run = await this._generated.create({
        // Empty is not a name and is not sent as one: null is what makes the server
        // leave it unnamed, which is what displays as the date.
        name: typed === '' ? null : typed,
        ...(profileId === null ? {} : { profileId }),
        sources: this.sources(),
        idempotencyKey: this._idempotencyKey,
      });

      // Straight into the basket, which is where somebody who just pressed Generate is
      // going. `leaveTo` replaces this sheet's history entry rather than pushing, so
      // the back button cannot return to a filled in form whose basket already exists
      // (plan 0031).
      await this._sheet.leaveTo(
        appPath(this._locale(), this._basePath, 'shopping-lists', run.list.id)
      );
    } catch {
      // The sheet stays open with everything still ticked, which is the whole of
      // section 3.4's failed state: nothing is lost, and the same key retries the same
      // run rather than composing a second one.
      this.submitting.set(false);
      this.errorKey.set('getList.error');
    }
  }

  /**
   * The history, reached from this sheet's header (plan 0045, section 3.1).
   *
   * `leaveTo` and not `dismiss`: this is a navigation to somewhere else rather than a
   * way out of the sheet, so the sheet's own fall animation would be playing while the
   * page underneath was already being replaced. It also replaces this entry rather than
   * pushing, so the back button from the history returns to the dashboard rather than
   * reopening a half filled sheet.
   */
  async openHistory(): Promise<void> {
    await this._sheet.leaveTo(
      appPath(this._locale(), this._basePath, BASKET_PATHS.list)
    );
  }

  /**
   * Cancel, Escape, the scrim, and the back button all arrive here.
   *
   * The fallback is the page this sheet was declared over, which is only reached on a
   * cold arrival at the sheet's own URL: with a page behind it in the stack `dismiss`
   * pops, and popping lands on whichever page that was regardless of what is passed.
   */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
      appPath(this._locale(), this._basePath, this._returnTo)
    );
  }

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  /**
   * Change which profile the run uses, and re-read what it draws from.
   *
   * The ticks belong to the profile and not to the sheet, so switching has to reopen
   * the tree on the new one's stored scope. Anything the person had already narrowed by
   * hand is discarded with it, which is the honest reading of the gesture: they picked
   * a different way of shopping, not a different name for this one.
   */
  onProfileChange(event: Event): void {
    const profileId = (event.target as HTMLSelectElement).value;
    this.selectedProfileId.set(profileId);
    void this._prefillFrom(profileId);
  }

  /**
   * A group's writable lists, **all of them** (plan 0049, section 4).
   *
   * `listLists` is cursor paginated and this used to ask for one page of a hundred and
   * stop, so a group with more than a hundred writable lists silently showed the first
   * hundred: every tick correct, and a list simply not there to be found. Silence was
   * the problem rather than the hundred, so it follows the cursor.
   *
   * {@link MAX_LIST_PAGES} is the stop, and it exists for the reason
   * `listSupermarkets`' does: a server answering with the cursor it was handed would
   * otherwise spin a phone forever, which is a worse failure than a listing that is
   * short by a page.
   */
  private async _loadLists(zoneId: string): Promise<void> {
    this._setLoaded(zoneId, { state: 'loading', lists: [] });

    try {
      const lists: { id: string; name: string }[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const answered = await this._lists.listLists(zoneId, {
          limit: LIST_PAGE_SIZE,
          ...(cursor === null ? {} : { cursor }),
        });

        // `WRITE` and nothing weaker. A list the caller may only read cannot feed a
        // run at all (backend `0051` section 2), so offering it would be a tick that
        // the server refuses on submit. Filtered per page rather than at the end, so
        // a group of read only lists costs no more memory than a group of writable
        // ones.
        lists.push(
          ...answered.items
            .filter((list) => list.myPermissions.includes('WRITE'))
            .map((list) => ({ id: list.id, name: list.name }))
        );

        cursor = answered.nextCursor;
        if (cursor === null) {
          break;
        }
      }

      this._setLoaded(zoneId, { state: 'loaded', lists });
    } catch {
      this._setLoaded(zoneId, { state: 'failed', lists: [] });
    }
  }

  private _setLoaded(zoneId: string, value: LoadedLists): void {
    this._loaded.update((current) => {
      const map = new Map(current);
      map.set(zoneId, value);
      return map;
    });
  }
}
