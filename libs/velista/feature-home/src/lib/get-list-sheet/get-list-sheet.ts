import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  GeneratedListStore,
  LIST_SERVICE,
  ShoppingProfileStore,
  ZoneStore,
  type ListServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  formatGeneratedDate,
  GENERATED_LIST_NAME_MAX_LENGTH,
  type GeneratedListSource,
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
 * ## The prechecked scope, and what this build cannot read
 *
 * Section 3.4 asks for the sources to be prechecked from the profile's stored generation
 * scope. **This build cannot read that scope**: plan 0046 deliberately keeps
 * `generationScope` and `generationSources` off `ShoppingProfile`, because `PATCH`
 * treats a present collection as a full replacement and a model carrying a field no
 * screen renders would eventually send back an empty one. So the tree precheckes every
 * group whole, which is what a profile's scope defaults to and the only scope anything
 * in this app can currently produce, and it sends **explicit** sources for whatever is
 * ticked rather than omitting them and letting the server fall back. What is on screen
 * is therefore what is used, which is the property worth keeping: a tree showing
 * everything ticked while the server quietly drew from three lists would be worse than
 * either behaviour on its own.
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
  private readonly _lists = inject<ListServiceI>(LIST_SERVICE);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

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
   * Belonging to no group is the one case this screen can be sure of without a request
   * per group. Somebody who is in groups but can write in none of them finds out one
   * step further in: their groups expand to "nothing here you can edit" and the submit
   * refuses, which is a worse answer than the sentence and the honest one available
   * without four requests on open.
   */
  readonly noSources = computed(() => this.zones().length === 0);

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
    const selection = this._selection();
    const sources: GeneratedListSource[] = [];

    for (const zone of this.zones()) {
      const chosen = selection.get(zone.id) ?? { mode: 'all' };
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
      }
    });
  }

  /** How a group's own checkbox draws: ticked, empty, or the dash between them. */
  zoneState(zoneId: string): 'all' | 'none' | 'some' {
    const chosen = this._selection().get(zoneId) ?? { mode: 'all' };
    if (chosen.mode === 'all') {
      return 'all';
    }
    return chosen.listIds.size === 0 ? 'none' : 'some';
  }

  listChecked(zoneId: string, listId: string): boolean {
    const chosen = this._selection().get(zoneId) ?? { mode: 'all' };
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

    const chosen = this._selection().get(zoneId) ?? { mode: 'all' };
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

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(appPath(this._locale(), this._basePath, 'home'));
  }

  onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  onProfileChange(event: Event): void {
    this.selectedProfileId.set((event.target as HTMLSelectElement).value);
  }

  private async _loadLists(zoneId: string): Promise<void> {
    this._setLoaded(zoneId, { state: 'loading', lists: [] });

    try {
      const page = await this._lists.listLists(zoneId, { limit: 100 });
      this._setLoaded(zoneId, {
        state: 'loaded',
        // `WRITE` and nothing weaker. A list the caller may only read cannot feed a
        // run at all (backend `0051` section 2), so offering it would be a tick that
        // the server refuses on submit.
        lists: page.items
          .filter((list) => list.myPermissions.includes('WRITE'))
          .map((list) => ({ id: list.id, name: list.name })),
      });
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
