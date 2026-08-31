import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import type {
  ProfileLoad,
  ShoppingProfile,
  Supermarket,
  WriteShoppingProfileRequest,
} from '@portfolio/velista/models';
import { Mutations, overlayKey, type Overlay } from '../mutations';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import {
  SHOPPING_PROFILE_SERVICE,
  type ShoppingProfileServiceI,
} from './shopping-profile-service';

/**
 * The controls a save is reported against, one per control on the page.
 *
 * Section 3.1 says saving is **per control**, so this is what the page keys its
 * failed treatment on. `postalCodes` and `chains` cover a whole collection because a
 * collection is what the wire replaces: adding one code is a write of all of them, and
 * a per chip state would be describing an operation that does not exist.
 */
export type ProfileField =
  | 'name'
  | 'addressText'
  | 'postalCodes'
  | 'chains'
  | 'minSavingCents';

/** How the last write to one control went. `idle` is also "nothing has been saved". */
export type FieldSaveState = 'idle' | 'saving' | 'failed';

/**
 * The caller's shopping profiles: the list, which one is being edited, and the chains
 * a preference can name (plan 0046, section 5).
 *
 * ## Why it lives in `data-access` and is provided by the app
 *
 * `ProfileStore`'s reasons, both of them. It resolves `SHOPPING_PROFILE_SERVICE`, so at
 * the root it would get that token's own default rather than whatever the app bound and
 * would quietly serve fixture chains beside a real account (rule D5). And its selection
 * outlives the page: `0045`'s generation sheet asks which profile a basket is being
 * built for, and a store owned by the profiles page would have been destroyed on the way
 * back to the list.
 *
 * ## The selected profile is an id, never a copy
 *
 * Everything on the page below the selector is derived from {@link selected}, which is
 * looked up in the list every time. A held copy would go stale the moment
 * `profiles.changed` arrived from another device, and the page would edit a profile the
 * server no longer has.
 *
 * ## What keeps a second device current
 *
 * `profiles.changed` carries the **whole list** rather than the profile that moved,
 * because every rule it exists to propagate is about the set: which one is default, how
 * many are left, and what a deleted one was replaced by. It is applied field by field
 * against the overlays in flight (plan 0004, section 7.2, case 3), so an echo of the
 * state somebody is editing does not overwrite what they typed.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9.
@Injectable()
export class ShoppingProfileStore {
  private readonly _service = inject<ShoppingProfileServiceI>(
    SHOPPING_PROFILE_SERVICE
  );
  private readonly _mutations = inject(Mutations);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);

  private readonly _raw = signal<readonly ShoppingProfile[]>([]);
  private readonly _state = signal<ProfileLoad>('loading');
  private readonly _error = signal<unknown>(null);
  private readonly _selectedId = signal<string | null>(null);
  private readonly _chains = signal<readonly Supermarket[]>([]);
  private readonly _saves = signal<ReadonlyMap<string, FieldSaveState>>(
    new Map()
  );

  /**
   * Postal codes the catalog says nobody we know serves.
   *
   * A set of the codes themselves rather than of chip ids: the flag is a property of
   * the code, and a chip that is removed and typed again is the same code.
   */
  private readonly _unserved = signal<ReadonlySet<string>>(new Set());

  /** Whether the chain listing has been fetched. It is cached for the page's life. */
  private _chainsAsked = false;

  /**
   * Every profile, in `position` order, with any pending local change applied.
   *
   * The overlay is what makes an edit feel instant while its request is out, and
   * dropping it is `Mutations.run`'s business rather than this store's.
   */
  readonly profiles = computed<readonly ShoppingProfile[]>(() =>
    this._raw().map((profile) =>
      this._mutations.applyOverlays(profile.id, profile)
    )
  );

  /** How the one read this store makes has got on. */
  readonly state = this._state.asReadonly();

  /** The failure behind a `failed` state, for its correlation id. */
  readonly error = this._error.asReadonly();

  /** Every chain in the catalog, unscoped, in the order the listing gave them. */
  readonly chains = this._chains.asReadonly();

  /**
   * The profile being edited.
   *
   * The selection when there is one and it still exists, else the default, else the
   * first. Null only before anything has loaded: the server creates the default profile
   * on the first read, so a loaded list is never empty.
   */
  readonly selected = computed<ShoppingProfile | null>(() => {
    const profiles = this.profiles();
    const id = this._selectedId();

    return (
      profiles.find((profile) => profile.id === id) ??
      profiles.find((profile) => profile.isDefault) ??
      profiles[0] ??
      null
    );
  });

  /**
   * Whether the selected profile says anything at all about where the caller shops.
   *
   * The client side of the server's `empty`, and the same rule: a profile holding only
   * *exclusions* is empty too, because "not DIA" is not a place. It is what clears the
   * scope banner the moment either field is filled in (section 8).
   */
  readonly scopeSaid = computed<boolean>(() => {
    const profile = this.selected();
    if (profile === null) {
      return false;
    }

    return (
      profile.postalCodes.length > 0 ||
      profile.chains.some((chain) => !chain.excluded)
    );
  });

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe, and a service several remotes
    // provide throws `NG0203` from it with a perfectly correct DI graph. Every other
    // store in this library says the same thing.
    const subscription = this._realtime.events.subscribe((event) => {
      if (event.type === 'profiles.changed') {
        this._applyRemote(event.profiles);
      }
    });

    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  /** How the last write to one control of one profile went. */
  saveState(profileId: string, field: ProfileField): FieldSaveState {
    return this._saves().get(overlayKey(profileId, field)) ?? 'idle';
  }

  /** Whether the catalog says nobody we know serves this postal code. */
  isUnserved(postalCode: string): boolean {
    return this._unserved().has(postalCode);
  }

  /**
   * The profile that becomes default if the given one is deleted, or null when it is
   * not the default and nothing changes hands.
   *
   * The oldest remaining, which is the server's own rule, so the confirm copy names
   * whoever will actually be promoted rather than whoever happens to be next on screen.
   */
  successorOf(profileId: string): ShoppingProfile | null {
    const profiles = this.profiles();
    const going = profiles.find((profile) => profile.id === profileId);

    if (going === undefined || !going.isDefault) {
      return null;
    }

    return profiles.find((profile) => profile.id !== profileId) ?? null;
  }

  /**
   * Read the list, and the chains beside it.
   *
   * A second call while profiles are already held does not blank them, for
   * `ProfileStore.load`'s reason: re-reading is how the retry line works, and a screen
   * that emptied itself first would flash between the list it has and the list it is
   * about to have again.
   */
  async load(): Promise<void> {
    if (this._raw().length === 0) {
      this._state.set('loading');
    }
    this._error.set(null);

    try {
      this._raw.set(await this._service.listProfiles());
      this._state.set('loaded');
    } catch (error) {
      this._error.set(error);
      this._state.set('failed');
      return;
    }

    // Both after the list and both allowed to fail quietly. A chain listing that did
    // not arrive costs the supermarket rows and nothing else, and the coverage flags
    // are an explanation rather than a control: neither is worth an error panel over a
    // page whose fields all work.
    await Promise.all([this._loadChains(), this.refreshCoverage()]);
  }

  /** Choose which profile the page is editing. */
  select(profileId: string): void {
    this._selectedId.set(profileId);
    void this.refreshCoverage();
  }

  /**
   * Ask the catalog what the selected profile's postal codes reach.
   *
   * Called after every postal code write as well as on load, because a code that was
   * just typed has no coverage answer yet and the flag has to land under its own chip.
   * A failure leaves the previous answer alone rather than clearing it: forgetting that
   * a code is unserved would silently withdraw an explanation somebody has read.
   *
   * A profile that has said nothing is not asked about at all. The endpoint answers
   * `CATALOG_SCOPE_REQUIRED` for one, by design, so asking would be spending a request
   * on a refusal the page can already work out from the profile it is holding, on the
   * very screen somebody is opening for the first time.
   */
  async refreshCoverage(): Promise<void> {
    const profile = this.selected();
    if (profile === null || !this.scopeSaid()) {
      return;
    }

    try {
      const scope = await this._service.describeScope(profile.id);
      this._unserved.set(
        new Set(
          scope.coverage
            .filter((entry) => !entry.served)
            .map((entry) => entry.postalCode)
        )
      );
    } catch {
      // See the doc comment. A profile that says nothing at all answers
      // `catalog_scope_required` here, which is not a failure worth reporting: the page
      // already knows, from the profile it is holding.
    }
  }

  /**
   * Mint a profile, select it, and answer it.
   *
   * Created with a null name rather than with the localized default written into it:
   * the server stores no English word because it does not know the caller's language,
   * and the page renders null as "My profile" in whichever one they are reading.
   */
  async create(): Promise<ShoppingProfile | null> {
    const outcome = await this._mutations.run(null, () =>
      this._service.createProfile({})
    );

    if (outcome.state === 'failed') {
      return null;
    }

    // **Upserted, never appended.** The server emits `profiles.changed` with the whole
    // list as it creates, and that event routinely arrives before the POST's own
    // response does. Appending would then add a profile the event had already put in
    // the list, and the selector would offer the new one twice with the same id, which
    // is also a duplicate track key. Found live rather than in a spec, because a fake
    // service emits no events.
    const created = outcome.value;
    this._raw.update((profiles) =>
      profiles.some((profile) => profile.id === created.id)
        ? profiles.map((profile) =>
            profile.id === created.id ? created : profile
          )
        : [...profiles, created]
    );
    this._selectedId.set(created.id);
    return created;
  }

  /**
   * Edit one control of one profile, optimistically.
   *
   * Section 3.1's three endings, and section 7.2's mechanism:
   *
   * - the overlay puts the new value on screen before the request leaves;
   * - a success replaces the row with the server's answer, which is what normalizes a
   *   trimmed name or an empty one that became null;
   * - a failure restores the control and leaves `failed` for the page to draw.
   *
   * The overlay's key names the **field**, so a `profiles.changed` for anything this
   * write does not claim still wins while the request is out.
   */
  async save(
    profileId: string,
    field: ProfileField,
    body: WriteShoppingProfileRequest,
    apply: (profile: ShoppingProfile) => ShoppingProfile
  ): Promise<'saved' | 'failed'> {
    const key = overlayKey(profileId, field);
    const overlay: Overlay<unknown> = {
      key,
      apply: (current) => apply(current as ShoppingProfile) as unknown,
      fields: [field],
    };

    this._setSave(key, 'saving');

    const outcome = await this._mutations.run(overlay, () =>
      this._service.updateProfile(profileId, body)
    );

    if (outcome.state === 'failed') {
      this._setSave(key, 'failed');
      return 'failed';
    }

    this._replace(outcome.value);
    this._setSave(key, 'idle');

    if (field === 'postalCodes') {
      void this.refreshCoverage();
    }

    return 'saved';
  }

  /** Move the default onto a profile. */
  async makeDefault(profileId: string): Promise<'saved' | 'failed'> {
    const outcome = await this._mutations.run(null, () =>
      this._service.makeDefault(profileId)
    );

    if (outcome.state === 'failed') {
      return 'failed';
    }

    // The whole list moves, not one row: exactly one profile is the default, so the
    // one that held it has to lose it here rather than on the next read.
    this._raw.update((profiles) =>
      profiles.map((profile) => ({
        ...profile,
        isDefault: profile.id === profileId,
      }))
    );

    return 'saved';
  }

  /**
   * Delete a profile.
   *
   * The successor is promoted locally by the same rule the server uses, so the page can
   * draw the new default on the frame the sheet closes rather than after a round trip.
   * `profiles.changed` arrives moments later and agrees.
   */
  async remove(profileId: string): Promise<'deleted' | 'failed'> {
    const successor = this.successorOf(profileId);

    const outcome = await this._mutations.run(null, () =>
      this._service.deleteProfile(profileId)
    );

    if (outcome.state === 'failed') {
      return 'failed';
    }

    this._raw.update((profiles) =>
      profiles
        .filter((profile) => profile.id !== profileId)
        .map((profile) => ({
          ...profile,
          isDefault:
            successor === null
              ? profile.isDefault
              : profile.id === successor.id,
        }))
    );

    if (this._selectedId() === profileId) {
      this._selectedId.set(null);
    }

    return 'deleted';
  }

  /** Drop what is held. Called on sign out and after an account delete. */
  clear(): void {
    this._raw.set([]);
    this._state.set('loading');
    this._error.set(null);
    this._selectedId.set(null);
    this._chains.set([]);
    this._unserved.set(new Set());
    this._saves.set(new Map());
    this._chainsAsked = false;
  }

  /**
   * The chain listing, once per store rather than once per visit.
   *
   * Cached for the page's life, which for an app scoped store is the session's: the
   * catalog's chains do not change while somebody is filling in an address, and a
   * second visit to this page should not spend a request re-learning them.
   */
  private async _loadChains(): Promise<void> {
    if (this._chainsAsked) {
      return;
    }
    this._chainsAsked = true;

    try {
      this._chains.set(await this._service.listSupermarkets());
    } catch {
      // Asked again on the next load, because the flag is not set back: a page with no
      // chain rows is worth one more attempt.
      this._chainsAsked = false;
    }
  }

  /**
   * Apply the whole list an event carried, field by field against what is in flight.
   *
   * Plan 0004 section 7.2, case 3, applied literally: a field with a pending overlay
   * keeps the local value until that overlay's own request resolves, and every other
   * field takes the server's. A profile the event does not mention is gone, which is
   * how a delete on another device reaches this one.
   */
  private _applyRemote(incoming: readonly ShoppingProfile[]): void {
    const local = new Map(this._raw().map((profile) => [profile.id, profile]));

    this._raw.set(
      incoming.map((profile) => {
        const held = local.get(profile.id);
        if (held === undefined) {
          return profile;
        }

        const claims = (field: ProfileField): boolean =>
          this._mutations.claims(overlayKey(profile.id, field));

        return {
          ...profile,
          name: claims('name') ? held.name : profile.name,
          addressText: claims('addressText')
            ? held.addressText
            : profile.addressText,
          minSavingCents: claims('minSavingCents')
            ? held.minSavingCents
            : profile.minSavingCents,
          postalCodes: claims('postalCodes')
            ? held.postalCodes
            : profile.postalCodes,
          chains: claims('chains') ? held.chains : profile.chains,
        };
      })
    );

    // An event can only arrive once something has answered, so a page still showing its
    // skeleton when one lands has a list and should stop.
    this._state.set('loaded');
  }

  private _replace(profile: ShoppingProfile): void {
    this._raw.update((profiles) =>
      profiles.map((held) => (held.id === profile.id ? profile : held))
    );
  }

  private _setSave(key: string, state: FieldSaveState): void {
    this._saves.update((current) => {
      const next = new Map(current);
      if (state === 'idle') {
        next.delete(key);
      } else {
        next.set(key, state);
      }
      return next;
    });
  }
}
