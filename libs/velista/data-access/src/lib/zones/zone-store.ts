import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  ZONE_LIST_PREVIEW_LIMIT,
  type ListPreview,
  type MyZone,
  type Zone,
  type ZoneRole,
} from '@portfolio/velista/models';
import { SessionStore } from '../auth/session-store';
import { Mutations } from '../mutations';
import {
  REALTIME_CLIENT,
  type RealtimeClientI,
} from '../realtime/realtime-client';
import type { RealtimeEvent } from '../realtime/realtime-events';
import { ZONE_SERVICE, type ZoneServiceI } from './zone-service';

/** How the store's one load is going, which is what `0003`'s state machine reads. */
export type ZoneLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * How one of the two ways in ended (plan 0008).
 *
 * Four cases and not three: `guest-account-lost` is kept apart from `failed` all the
 * way up to the screen, because the two want opposite things from the person looking
 * at them. A failure asks them to try again; this one must not, since trying again is
 * how the second guest account gets minted (plan 0004, rule D3).
 */
export type ZoneEntryOutcome =
  | { readonly state: 'created'; readonly zoneId: string }
  | { readonly state: 'joined'; readonly zoneId: string }
  | { readonly state: 'guest-account-lost' }
  | { readonly state: 'failed'; readonly error: unknown };

/**
 * The way in the caller has just come through, for the dashboard to say something
 * about once.
 *
 * It lives on the store rather than travelling in router state, because the two
 * screens that can start it are not the screen that reports it, and the store is
 * already the one thing above both that survives the navigation between them. Router
 * state would work and would also survive a reload through the history entry, which
 * is exactly wrong: an invite card is about what just happened, not about the URL.
 */
export type ZoneEntry =
  | { readonly kind: 'created'; readonly zoneId: string }
  | { readonly kind: 'joined'; readonly zoneId: string };

/**
 * A zone the caller has just lost, and why.
 *
 * Three events take somebody out of a zone while they are looking at it, and the page
 * has to leave for the dashboard on all three. They are kept apart because the copy
 * differs and because one of them is not about them at all: being removed is something
 * that happened **to** them, while a deletion is somebody with the right to do it doing
 * it. Neither is an error, and neither may render as one (plan 0010, section 3.5).
 *
 * It lives on the store rather than travelling in router state for `ZoneEntry`'s
 * reason: the screen that learns of it is not always the screen that reports it, and
 * the store is the one thing above both that survives the navigation between them.
 */
export interface ZoneDeparture {
  readonly zoneId: string;
  readonly reason: 'kicked' | 'banned' | 'deleted';
}

/**
 * How a governance write ended.
 *
 * `MutationOutcome`'s three cases collapsed to two, deliberately: none of these
 * records carries a concurrency version, so `overwritten` cannot arise for any of them
 * (plan 0004, section 7.2). A type that admitted it would be asking every caller to
 * handle a state that cannot happen.
 */
export type ZoneWriteOutcome =
  | { readonly state: 'succeeded' }
  | { readonly state: 'failed'; readonly error: unknown };

/**
 * The caller's zones: the cache, the realtime application, and the room subscriptions.
 *
 * ## Why this is in `data-access` and not in `feature-home`
 *
 * Realtime events arrive for a room regardless of which page is mounted. A store owned
 * by `feature-home` would be destroyed the moment the user opens a list, so the room
 * would be left and rejoined on every navigation, the cache thrown away, and going
 * back would re-fetch everything. On the connection this product is used over, that is
 * the difference between an app that feels instant and one that does not
 * (plan 0004, section 7.1).
 *
 * A page facade is shaped like a screen and lives in its feature library. A store is
 * shaped like the domain and lives here. Conflating the two is the most likely way this
 * design gets misbuilt.
 */
// Provided by the app layer, never root: rule D5, plan 0004 section 9. It reaches
// something only the app can supply, and the app injector is a child of the root one.
@Injectable()
export class ZoneStore {
  private readonly _zones = inject<ZoneServiceI>(ZONE_SERVICE);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _session = inject(SessionStore);
  private readonly _mutations = inject(Mutations);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _byId = signal<ReadonlyMap<string, MyZone>>(new Map());
  private readonly _order = signal<readonly string[]>([]);
  private readonly _state = signal<ZoneLoadState>('idle');
  private readonly _error = signal<unknown>(null);
  private readonly _lastEntry = signal<ZoneEntry | null>(null);
  private readonly _lastCodeChange = signal<string | null>(null);
  private readonly _departure = signal<ZoneDeparture | null>(null);

  /**
   * How the load of one specific zone is going, keyed by id.
   *
   * Separate from `_state`, which is the dashboard's one load. A group page opened by
   * deep link is loading while the dashboard's own state is still `idle`, and folding
   * the two would make each screen's skeleton depend on whether the other had been
   * visited.
   */
  private readonly _zoneState = signal<ReadonlyMap<string, ZoneLoadState>>(
    new Map()
  );

  /**
   * Rooms currently held, so they can be released and re-joined on a change.
   *
   * The staff flag is stored alongside the release, because a subscription held under
   * one role is the wrong subscription under another, and this map is the only record
   * of which one this store asked for.
   */
  private readonly _rooms = new Map<
    string,
    { readonly isStaff: boolean; readonly release: () => void }
  >();

  readonly state = this._state.asReadonly();
  readonly error = this._error.asReadonly();

  /** The way in just taken, or null. Cleared by whoever renders it. */
  readonly lastEntry = this._lastEntry.asReadonly();

  /**
   * The zone whose join code was just replaced, or null.
   *
   * The same shape as `lastEntry` and for the same reason: landing on a card that
   * quietly holds a different six characters is not the same as being told the code
   * is new, and it must be said once rather than every time the page is drawn.
   */
  readonly lastCodeChange = this._lastCodeChange.asReadonly();

  /** The zone just lost, or null. Cleared by whoever reports it. */
  readonly departure = this._departure.asReadonly();

  /** How the load of one particular zone is going, for the group page's skeleton. */
  readonly zoneState = this._zoneState.asReadonly();

  /** The caller's zones, in the order the server returned them. */
  readonly myZones = computed<readonly MyZone[]>(() => {
    const byId = this._byId();
    return this._order().flatMap((id) => {
      const zone = byId.get(id);
      return zone === undefined ? [] : [zone];
    });
  });

  /**
   * Zones whose realtime room the server refused, so their data is not live.
   *
   * A pass-through: the client answers zone ids and this is the name the rest of the
   * app knows them by. It used to strip a `zone:` prefix off room names, which was
   * wrong for the one room it most needed to be right about — `zone:abc:staff` strips
   * to `abc:staff`, a zone id matching nothing, so the entry could never clear.
   */
  readonly staleZoneIds = computed(() => this._realtime.refusedZones());

  constructor() {
    // By hand, not `takeUntilDestroyed`: `@angular/core/rxjs-interop` is a secondary
    // entry point module federation does not dedupe, and a service several remotes
    // provide throws `NG0203` from it with a perfectly correct DI graph.
    // `MembershipStore`, `PresenceStore` and `ProfileStore` all say the same thing.
    const subscription = this._realtime.events.subscribe((event) =>
      this._apply(event)
    );

    this._destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      this._releaseRooms();
    });
  }

  /**
   * Load the caller's zones.
   *
   * Anonymous callers have none and must not be sent to a guarded endpoint to find
   * that out: `0003`'s anonymous state is a designed screen, not a 401 handled
   * gracefully.
   */
  async load(): Promise<void> {
    if (!this._session.isAuthenticated()) {
      this._byId.set(new Map());
      this._order.set([]);
      this._state.set('loaded');
      return;
    }

    this._state.set('loading');
    this._error.set(null);

    try {
      const page = await this._zones.listMyZones();
      this._byId.set(new Map(page.items.map((zone) => [zone.id, zone])));
      this._order.set(page.items.map((zone) => zone.id));
      this._state.set('loaded');
      this._syncRooms();
    } catch (error) {
      this._error.set(error);
      this._state.set('failed');
    }
  }

  /** Insert a zone the caller just created, without waiting for a refetch. */
  upsert(zone: MyZone): void {
    this._byId.update((current) => new Map(current).set(zone.id, zone));
    this._order.update((current) =>
      current.includes(zone.id) ? current : [zone.id, ...current]
    );
    this._syncRooms();
  }

  /**
   * Create a zone, and have the dashboard render it before the reload confirms it.
   *
   * `POST /v1/zones` answers a `Zone`, and the dashboard renders a `MyZone`. The four
   * fields in between are not guessed: for a zone created one moment ago the caller is
   * its OWNER, their membership is APPROVED, there is one member, and there are no
   * lists and nobody waiting. Composing those and upserting is what puts the group on
   * screen immediately, and the reconciling reload right behind it is what keeps that
   * from being a story the client tells itself (plan 0008, section 5.5).
   *
   * Through `Mutations.run` like every other write in this app (rule D2), which is what
   * keeps an offline queue a change to one file rather than to every call site. No
   * overlay: an overlay describes a pending edit to a record that already exists, and
   * this record does not exist anywhere until the server answers.
   */
  async createZone(name: string): Promise<ZoneEntryOutcome> {
    const outcome = await this._mutations.run(null, () =>
      this._zones.createZone(name)
    );

    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }

    if (outcome.value.state === 'guest-account-lost') {
      // Rule D3 refused to send the request, so nothing was created and nothing
      // should be retried. See `ZoneCreationResult`.
      return { state: 'guest-account-lost' };
    }

    const { zone } = outcome.value;
    this.upsert({
      ...zone,
      myRole: 'OWNER',
      myStatus: 'APPROVED',
      counts: {
        memberCount: 1,
        listCount: 0,
        // The creator is the owner, so they are staff and this number is theirs
        // to see. It is zero, which is not the same as being unable to see it.
        pendingRequestCount: 0,
        firstPendingRequesterName: null,
      },
      lists: [],
    });
    this._lastEntry.set({ kind: 'created', zoneId: zone.id });

    // Deliberately not awaited. The row on screen is already correct, so making the
    // caller wait for the reload would buy a second spinner and nothing else.
    void this._reconcile();

    return { state: 'created', zoneId: zone.id };
  }

  /**
   * Ask to join a zone by its code.
   *
   * Nothing can be composed here the way a create can: `MembershipView` carries a
   * `zoneId` and no name, and no endpoint turns a code into a zone (section 5.7). So
   * this reloads, and **awaits** the reload, because the list is where the group's real
   * name comes from: core's `listMine` selects APPROVED and PENDING memberships alike
   * and inner joins the zone row for both, so a membership that is still waiting comes
   * back as a full `MyZoneView` (section 5.6).
   */
  async joinZone(joinCode: string): Promise<ZoneEntryOutcome> {
    const outcome = await this._mutations.run(null, () =>
      this._zones.joinZone(joinCode)
    );

    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }

    if (outcome.value.state === 'guest-account-lost') {
      return { state: 'guest-account-lost' };
    }

    const { membership } = outcome.value;
    await this._reconcile();
    this._lastEntry.set({ kind: 'joined', zoneId: membership.zoneId });

    return { state: 'joined', zoneId: membership.zoneId };
  }

  /** The dashboard has said what just happened. It does not say it twice. */
  clearLastEntry(): void {
    this._lastEntry.set(null);
  }

  /** The group page has said the code is new. It does not say it twice. */
  clearLastCodeChange(): void {
    this._lastCodeChange.set(null);
  }

  /** One zone out of the cache, or undefined when it has not been loaded. */
  zoneById(zoneId: string): MyZone | undefined {
    return this._byId().get(zoneId);
  }

  /**
   * Load one zone.
   *
   * The group page calls this on open **even when the zone is already cached**, and
   * that is deliberate rather than wasteful: the cached copy came from the dashboard's
   * list, which is a page of summaries that may be minutes old, and the header it
   * renders from it is what makes the screen appear instantly. The refetch reconciles
   * behind that, which is why the state stays out of `loading` when there is already
   * something to draw.
   */
  async loadZone(zoneId: string): Promise<void> {
    const cached = this.zoneById(zoneId);
    this._setZoneState(zoneId, cached === undefined ? 'loading' : 'loaded');
    this._error.set(null);

    try {
      this.upsert(await this._zones.getZone(zoneId));
      this._setZoneState(zoneId, 'loaded');
    } catch (error) {
      this._error.set(error);
      // A refetch that failed over a zone already on screen leaves the screen alone.
      // The cached header is still the best thing available, and replacing a correct
      // group with an error panel because a background reconcile failed is worse than
      // being briefly out of date.
      this._setZoneState(zoneId, cached === undefined ? 'failed' : 'loaded');
    }
  }

  /** The page has reported the departure. It does not report it twice. */
  clearDeparture(): void {
    this._departure.set(null);
  }

  /**
   * Rename a group. OWNER or ADMIN.
   *
   * Every governance write below has the same three-line shape and the same reasons
   * for it: through `Mutations.run` (rule D2), the cache patched from the **server's**
   * answer rather than from what was asked for, and a `failed` outcome returned rather
   * than swallowed, because the component that failed is the one that has to say so.
   */
  async renameZone(zoneId: string, name: string): Promise<ZoneWriteOutcome> {
    return this._write(() => this._zones.renameZone(zoneId, name));
  }

  /** Mint a new join code. The old one stops working for everybody it was sent to. */
  async regenerateJoinCode(zoneId: string): Promise<ZoneWriteOutcome> {
    const outcome = await this._write(() =>
      this._zones.regenerateJoinCode(zoneId)
    );

    if (outcome.state === 'succeeded') {
      this._lastCodeChange.set(zoneId);
    }

    return outcome;
  }

  /**
   * Take on an ownerless group. ADMIN only, and only while nobody owns it.
   *
   * The caller becomes the owner and the zone returns to ACTIVE, so `myRole` is
   * updated here as well as the zone's own fields: the server's `ZoneView` says who
   * owns it now and cannot say what that makes the caller.
   */
  async claimOwnership(zoneId: string): Promise<ZoneWriteOutcome> {
    const outcome = await this._write(() => this._zones.claimOwnership(zoneId));

    if (outcome.state === 'succeeded') {
      this._patch(zoneId, (zone) => ({ ...zone, myRole: 'OWNER' }));
      this._syncRooms();
    }

    return outcome;
  }

  /**
   * Delete a group. OWNER only, and there is no undo anywhere in the product.
   *
   * The zone is removed from the cache on success rather than waiting for the
   * `zone.deleted` broadcast, so the dashboard behind is already correct when the
   * caller lands back on it. No departure is recorded: they did this, and being told
   * what they just chose is noise.
   */
  async deleteZone(zoneId: string): Promise<ZoneWriteOutcome> {
    const outcome = await this._mutations.run(null, () =>
      this._zones.deleteZone(zoneId)
    );

    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }

    this._remove(zoneId);
    return { state: 'succeeded' };
  }

  /**
   * Keep a zone's counts honest after a membership changed **from this device**.
   *
   * The server broadcasts `zone.countsUpdated` with authoritative numbers a moment
   * later, and that is what the counts ultimately come from. This exists because "a
   * moment later" is not what an acceptance criterion asks for: approving somebody has
   * to move the member count immediately, with no reload, and the person who tapped it
   * is looking straight at the number.
   *
   * Deliberately a small, named, one-way nudge rather than a general "set the counts"
   * seam. Nothing outside this store may decide what a count is; a caller may only say
   * what it just did, and the store works out what that means.
   */
  recordMembershipChange(
    zoneId: string,
    change: 'approved' | 'rejected' | 'removed'
  ): void {
    this._patch(zoneId, (zone) => {
      const pending = zone.counts.pendingRequestCount;

      return {
        ...zone,
        counts: {
          ...zone.counts,
          memberCount: Math.max(
            0,
            zone.counts.memberCount +
              (change === 'approved' ? 1 : 0) -
              (change === 'removed' ? 1 : 0)
          ),
          // A null stays null. It means "you may not see this", and turning it into a
          // number because something happened would invent a permission (section 4.3).
          pendingRequestCount:
            pending === null || change === 'removed'
              ? pending
              : Math.max(0, pending - 1),
          // The named requester may well be the one just answered, and the store
          // cannot tell. Clearing it is the honest option: the next broadcast or load
          // supplies the new oldest, and a stale name on a card is worse than none.
          firstPendingRequesterName:
            change === 'removed' ? zone.counts.firstPendingRequesterName : null,
        },
      };
    });
  }

  /** The shared shape of every governance write. See {@link renameZone}. */
  private async _write(send: () => Promise<Zone>): Promise<ZoneWriteOutcome> {
    const outcome = await this._mutations.run(null, send);

    if (outcome.state === 'failed') {
      return { state: 'failed', error: outcome.error };
    }

    const zone = outcome.value;
    this._patch(zone.id, (current) => ({
      ...current,
      name: zone.name,
      joinCode: zone.joinCode,
      status: zone.status,
      ownerUserId: zone.ownerUserId,
    }));

    return { state: 'succeeded' };
  }

  private _setZoneState(zoneId: string, state: ZoneLoadState): void {
    this._zoneState.update((current) => new Map(current).set(zoneId, state));
  }

  /**
   * Reload after a mutation, without the page dropping back to a skeleton.
   *
   * `load` moves the state to `loading`, which is right on a cold start and wrong here:
   * the cache already holds the zone that was just created, and `selectHomeState`
   * renders `loading` as a skeleton, so reusing `load` would replace a correct
   * dashboard with a spinner for the length of a request. A failure is swallowed for
   * the same reason. What is on screen is not made worse by a reload that did not
   * arrive, and the failure path that matters is the mutation's own, which the caller
   * already holds.
   */
  private async _reconcile(): Promise<void> {
    try {
      const page = await this._zones.listMyZones();
      this._byId.set(new Map(page.items.map((zone) => [zone.id, zone])));
      this._order.set(page.items.map((zone) => zone.id));
      this._state.set('loaded');
      this._syncRooms();
    } catch {
      // Deliberately quiet. See above.
    }
  }

  /**
   * Join a room per visible zone the caller is actually **in**.
   *
   * Only zone rooms, deliberately. List and line events are broadcast to the zone room
   * as well as the list room (`realtime/src/app/consumer/jetstream.consumer.ts:182`),
   * so subscribing per zone already delivers everything `0003` needs for its live
   * counts. Subscribing to each list on the home screen as well would pay for the same
   * bytes twice.
   *
   * ## Approved only, and this is a bug fix (plan 0026)
   *
   * `myZones()` includes a zone the caller has only **requested** to join: a join
   * request loads a pending summary so the dashboard can show the request it is
   * waiting on. Asking for that zone's room is a guaranteed no, because `checkZone`
   * on the server is `requireApproved`, and the answer is a `{ ok: false }` that
   * `RoomRegistry` latches for the whole connection by design.
   *
   * So being approved did not fix it. The approval arrives on the caller's own
   * channel (backend `0030`, section 4.1, which exists precisely because a pending
   * member is not in the zone room where their approval is announced), `myStatus`
   * flips, and this method runs again, and the zone is **already held**: the loops
   * below see a room whose staff intent has not changed and do nothing at all. Even
   * had they re-asked, the registry skips a latched zone. The group then showed the
   * "not updating live right now" notice until the next connection, which is why
   * reloading the page has always fixed it.
   *
   * Filtering here fixes both halves at once and needs no new mechanism. A pending
   * zone is never asked for, so no refusal is ever latched and no false notice is
   * ever drawn; and when the approval lands, the zone enters `wanted` for the first
   * time and is subscribed fresh. Releasing on the way in is what makes it
   * self-healing: the registry drops a zone's latch with its last holder, so even a
   * refusal from some other cause is cleared by the standing changing.
   */
  private _syncRooms(): void {
    const wanted = new Map(
      this.myZones()
        .filter((zone) => zone.myStatus === 'APPROVED')
        .map((zone) => [
          zone.id,
          // Staff also join `zone:{id}:staff`, which is the only room that carries the
          // governance fields on a counts broadcast. Without it an owner's join request
          // row would go stale until the next full load, which is the one number on the
          // card that most wants to be live.
          //
          // **Rule G3 (plan 0010, section 5.3): from `myRole`, never from the counts.**
          // A non-null `pendingRequestCount` is also the backend's answer to "is this
          // caller staff", and it was what decided this until `0010`. The two disagree
          // for exactly as long as it matters: `member.roleChanged` updates `myRole`
          // immediately and leaves the counts alone, and `myRole` is the one that is
          // right straight away.
          //
          // The rule used to carry a second justification, that a demoted admin asking
          // for a refused staff room raises a permanent false stale badge. That one is
          // void: the server answers `zone.subscribe` with `{ ok: true }` whether or not
          // the staff join happened, so a staff room cannot be refused at all (plan
          // 0016, section 3.2). The reason above stands on its own and is enough.
          zone.myRole === 'OWNER' || zone.myRole === 'ADMIN',
        ])
    );

    for (const [zoneId, held] of this._rooms) {
      // Released when the zone is gone, and also when the caller's **standing** in it
      // changed: a subscription held under the old role is the wrong subscription. The
      // client turns that release-and-reacquire into a bare re-subscribe with no gap,
      // because the staff intent rides on the zone subscription rather than being a
      // room of its own.
      if (!wanted.has(zoneId) || wanted.get(zoneId) !== held.isStaff) {
        held.release();
        this._rooms.delete(zoneId);
      }
    }

    for (const [zoneId, isStaff] of wanted) {
      if (!this._rooms.has(zoneId)) {
        this._rooms.set(zoneId, {
          isStaff,
          release: this._realtime.subscribeZone(zoneId, { staff: isStaff }),
        });
      }
    }
  }

  private _releaseRooms(): void {
    for (const held of this._rooms.values()) {
      held.release();
    }
    this._rooms.clear();
  }

  /**
   * Apply one event.
   *
   * Every branch is a whole-record replace or a targeted field update, never a merge
   * of an unvalidated payload: the event has already been through its mapper, and what
   * arrives here is a model this app owns (rule D4).
   */
  private _apply(event: RealtimeEvent): void {
    switch (event.type) {
      case 'zone.created': {
        // Only ever addressed to the creator, and checked anyway: a client that trusts
        // routing to be its authorization is one server bug away from rendering
        // somebody else's group.
        if (event.zone.ownerUserId === this._session.userId()) {
          // The event carries a `Zone` and the dashboard draws a `MyZone`. Composing
          // the difference here would mean inventing `counts` and `lists`, which is
          // the very thing `_patch` drops an event rather than do, so the event is
          // the signal and the load is the answer. `upsert` prepends, which is what
          // puts the new group at the top of the dashboard.
          //
          // The tab that created the zone receives this too, having already upserted
          // optimistically in `createZone`. The extra load is idempotent and it is
          // exactly the reconciling read that method says it wants. No "did I do
          // this" flag: a store that tracked which of its own actions caused which
          // event would have to stay right about that forever.
          void this.loadZone(event.zone.id);
        }
        break;
      }

      case 'zone.updated':
      case 'zone.markedForDeletion': {
        this._patch(event.zone.id, (zone) => withZoneFields(zone, event.zone));
        break;
      }

      case 'zone.ownershipChanged': {
        // The zone's own fields, exactly as `zone.updated`, plus the one thing the
        // payload states without saying it: a `ZoneView` says who owns the group now,
        // and it cannot say what that makes the caller. Two memberships changed role
        // and the transfer publishes no membership event for either (plan 0020,
        // section 2), so the caller's own role is derived here from `ownerUserId`.
        //
        // Deriving it here is not a guess, and it does not become redundant once the
        // server publishes those two events. `claimOwnership` already writes
        // `myRole: 'OWNER'` after a successful claim rather than waiting to be told,
        // so the store already holds that `ownerUserId` and `myRole` cannot disagree;
        // asserting that for a local write and not for a remote one is how they came
        // to disagree here. Backend `0029` now publishes a `member.roleChanged` for
        // each of the two memberships a transfer moves, and both writers compute the
        // same value from the same fact, so whichever arrives second changes nothing.
        // Which is also why this stays: JetStream preserves order per subject and not
        // across them, so the two can arrive either way round.
        const held = this._byId().get(event.zone.id);
        if (held === undefined) {
          // Same answer `_patch` gives: an event for a zone the caller never loaded
          // is not news, and a record invented from it would have no name and no
          // counts.
          break;
        }

        const myRole = roleAfterOwnershipChange(
          held.myRole,
          event.zone.ownerUserId,
          this._session.userId()
        );

        this._patch(event.zone.id, (zone) => ({
          ...withZoneFields(zone, event.zone),
          myRole,
        }));

        if (myRole !== held.myRole) {
          // **Rule G3**, for the reason the `member.roleChanged` branch below gives:
          // the staff room follows `myRole`, and this is now an event that moves it.
          this._syncRooms();
        }
        break;
      }

      case 'zone.deleted': {
        // Recorded before the removal, so a page open on this zone has something to
        // report when its own lookup comes back empty. Only for a zone the caller
        // actually held: an event for one they never loaded is not news.
        if (this._byId().has(event.zoneId)) {
          this._departure.set({ zoneId: event.zoneId, reason: 'deleted' });
        }
        this._remove(event.zoneId);
        break;
      }

      case 'zone.countsUpdated': {
        this._patch(event.zoneId, (zone) => ({
          ...zone,
          counts: {
            ...zone.counts,
            memberCount: event.memberCount,
            // The plain zone room sends both governance fields as null, and the
            // staff room sends them filled. Taking the null would blank the join
            // request row for an owner every time somebody joined, so a null is
            // read as "this broadcast could not say" and the known value is kept.
            pendingRequestCount:
              event.pendingRequestCount ?? zone.counts.pendingRequestCount,
            firstPendingRequesterName:
              event.pendingRequestCount === null
                ? zone.counts.firstPendingRequesterName
                : event.firstPendingRequesterName,
          },
        }));
        break;
      }

      case 'member.roleChanged':
      case 'member.approved':
      case 'member.kicked':
      case 'member.banned': {
        const { membership } = event;
        const isMe = membership.userId === this._session.userId();

        if (
          isMe &&
          (membership.status === 'KICKED' || membership.status === 'BANNED')
        ) {
          // The caller is no longer in this zone. Removing it is what makes the card
          // disappear without a refresh, which is an acceptance criterion in `0003`.
          //
          // The departure is recorded as well, because `0010` opens a page **on** this
          // zone: the dashboard only needs the card gone, while a group page has to
          // leave and say why. Kicked and banned are kept apart here even though the
          // copy is currently the same for both, since the difference is real and the
          // event is the only place it is known.
          if (this._byId().has(membership.zoneId)) {
            this._departure.set({
              zoneId: membership.zoneId,
              reason: membership.status === 'BANNED' ? 'banned' : 'kicked',
            });
          }
          this._remove(membership.zoneId);
          break;
        }

        // Read before the patch, because after it there is nothing left to compare
        // against. `undefined` for a zone the store has never seen, which section 4.3
        // of `0021` wants to load rather than ignore.
        const previousStatus = this._byId().get(membership.zoneId)?.myStatus;

        this._patch(membership.zoneId, (zone) =>
          isMe
            ? { ...zone, myRole: membership.role, myStatus: membership.status }
            : zone
        );

        if (isMe) {
          // **Rule G3.** The staff room follows `myRole`, and this is the event that
          // changes it. Without re-syncing here, a just promoted owner would not
          // receive the governance counts until the next full load, and a just
          // demoted admin would keep asking for a room the server now refuses, which
          // surfaces as a permanent and untrue "not live" badge on the group.
          this._syncRooms();

          if (
            event.type === 'member.approved' &&
            membership.status === 'APPROVED' &&
            previousStatus !== 'APPROVED'
          ) {
            // A zone the caller was PENDING in was loaded as a pending summary: its
            // counts are the pending view's and `toZoneCard` renders its lists as
            // empty by definition. Flipping the status alone makes the card tappable
            // and opens onto a group page with nothing in it, so the real record is
            // fetched.
            //
            // Guarded on the previous status rather than run on every approval for
            // the caller, so a redelivery, or an approval for a zone already
            // approved, does not cost a request each. A zone absent from the cache
            // has no previous status and is loaded, which is correct: `loadZone` is
            // a fetch and an upsert, not a patch, so it works for a request made on
            // another device and approved before this one ever listed its zones.
            // This is the one place an event creates a record here, and it is
            // legitimate because the record comes from the server.
            void this.loadZone(membership.zoneId);
          }
        }
        break;
      }

      case 'member.joined': {
        this._patch(event.membership.zoneId, (zone) =>
          bumpMembers(zone, event.membership.status === 'APPROVED' ? 1 : 0)
        );
        break;
      }

      case 'member.usernameChanged':
        // Nothing on a zone card renders a member's name, so there is nothing here to
        // patch. This used to be recorded on a one shot channel for the members screen
        // to read; `MembershipStore` owns those rows now and applies this event with
        // the other five, so the channel had one writer and no readers (plan 0018).
        break;

      case 'user.usernameChanged':
        // The caller's own global name. Nothing on a zone card renders it, and
        // `ProfileStore` owns it, which is the store `SessionStore` prefers over the
        // token pair (rule A2).
        break;

      case 'member.rejected':
        // Carries no zone id, so there is nothing to apply it to. The count corrects
        // itself on the next load rather than being guessed at here.
        break;

      // `listCount` is access filtered per caller, so the counts broadcast cannot
      // carry it and the store keeps its own from the list events it already gets.
      //
      // The **preview** underneath the count is kept in step here too (plan 0019,
      // section 5). Before that it was not, so a card could say "4 lists" over three
      // rows until the next full load.
      case 'list.created':
        this._patch(event.list.zoneId, (zone) =>
          addListPreview(bumpLists(zone, 1), {
            id: event.list.id,
            name: event.list.name,
            // Facts, not guesses: a list created this instant has no lines in it.
            lineCount: 0,
            readyCount: 0,
          })
        );
        break;

      case 'list.updated':
        // Rename in place. Only the preview rows are held here, so a list outside the
        // preview is a no-op, which is right: nothing on this screen shows its name.
        this._patch(event.list.zoneId, (zone) =>
          renameListPreview(zone, event.list.id, event.list.name)
        );
        break;

      case 'list.deleted': {
        // The event carries a list id and no zone id, and the stream is merged across
        // every room, so the zone has to be found by the row it holds. A list outside
        // the preview cannot be located at all and its count therefore stands until
        // the next load; the alternative is a request per deletion to learn a zone id
        // the card is about to re-read anyway.
        const zoneId = this._zoneIdOfPreviewedList(event.listId);
        if (zoneId !== null) {
          this._patch(zoneId, (zone) =>
            removeListPreview(bumpLists(zone, -1), event.listId)
          );
        }
        break;
      }

      case 'list.accessChanged':
      case 'line.added':
      case 'line.updated':
      case 'line.reordered':
      case 'line.deleted':
      case 'comment.added':
      case 'comment.updated':
        // List-scoped traffic reaching the zone room. `ListStore` owns these; the zone
        // summary's per-list counts are refreshed by its own load rather than being
        // recomputed from a stream the store only sees part of.
        //
        // `list.accessChanged` stays here on purpose: the payload says access changed,
        // not whether **this** caller gained or lost it, so adding or removing a row
        // would be a guess, and guessing wrong puts a list on a dashboard its owner
        // cannot open.
        break;

      case 'merge.requested':
      case 'merge.approved':
      case 'merge.rejected':
      case 'presence.zoneUpdated':
      case 'presence.listUpdated':
        // Merges have no page yet, and presence is advisory and owned elsewhere
        // (plan 0004, section 6.7).
        break;
    }
  }

  /** Which loaded zone, if any, has this list in the three rows it is previewing. */
  private _zoneIdOfPreviewedList(listId: string): string | null {
    for (const [zoneId, zone] of this._byId()) {
      if (zone.lists.some((list) => list.id === listId)) {
        return zoneId;
      }
    }

    return null;
  }

  private _patch(zoneId: string, update: (zone: MyZone) => MyZone): void {
    this._byId.update((current) => {
      const existing = current.get(zoneId);
      if (existing === undefined) {
        // An event for a zone that is not on screen. Dropping it is correct: the
        // store holds what was loaded, and inventing a partial record from an event
        // would render a card with no name and no counts.
        return current;
      }

      return new Map(current).set(zoneId, update(existing));
    });
  }

  private _remove(zoneId: string): void {
    this._byId.update((current) => {
      const next = new Map(current);
      next.delete(zoneId);
      return next;
    });
    this._order.update((current) => current.filter((id) => id !== zoneId));

    const held = this._rooms.get(zoneId);
    if (held !== undefined) {
      held.release();
      this._rooms.delete(zoneId);
    }
  }
}

/**
 * The zone's own fields, replaced from the `ZoneView` an event carried.
 *
 * Shared by the events that carry a whole zone, so the set of fields a broadcast is
 * allowed to overwrite is written once. Deliberately not a spread of `next`: an event's
 * `Zone` and the cached `MyZone` are different types, and a blanket merge would drop
 * the caller's own standing and the counts every time somebody renamed the group.
 */
function withZoneFields(zone: MyZone, next: Zone): MyZone {
  return {
    ...zone,
    name: next.name,
    joinCode: next.joinCode,
    status: next.status,
    ownerUserId: next.ownerUserId,
  };
}

/**
 * The caller's role after somebody became the owner of a group they are in.
 *
 * Three cases, and only the second is worth an argument:
 *
 * - the new owner is the caller, so the caller is the owner;
 * - the caller **was** the owner and somebody else is now, so the caller is an admin.
 *   Not a guess: `ZoneService.transferOwnership` demotes the outgoing owner to `ADMIN`
 *   unconditionally, in the same transaction that promotes the target;
 * - otherwise the change was between two other people and says nothing about the
 *   caller's own role.
 */
function roleAfterOwnershipChange(
  current: ZoneRole,
  ownerUserId: string | null,
  myUserId: string | null
): ZoneRole {
  if (myUserId !== null && ownerUserId === myUserId) {
    return 'OWNER';
  }

  return current === 'OWNER' ? 'ADMIN' : current;
}

function bumpMembers(zone: MyZone, by: number): MyZone {
  return {
    ...zone,
    counts: {
      ...zone.counts,
      memberCount: Math.max(0, zone.counts.memberCount + by),
    },
  };
}

function bumpLists(zone: MyZone, by: number): MyZone {
  return {
    ...zone,
    counts: {
      ...zone.counts,
      listCount: Math.max(0, zone.counts.listCount + by),
    },
  };
}

/**
 * Put a just created list into the card's preview, **if there is room**.
 *
 * A zone already showing `ZONE_LIST_PREVIEW_LIMIT` rows gets the count bump and
 * nothing else. Evicting the oldest would be the right answer only if the server's
 * ordering were reproducible here, and it is not: the preview is ordered by recent
 * activity, which the client cannot compute for lists it has never loaded. So a full
 * preview is left exactly as it arrived (plan 0019, section 5).
 */
function addListPreview(zone: MyZone, list: ListPreview): MyZone {
  if (
    zone.lists.length >= ZONE_LIST_PREVIEW_LIMIT ||
    zone.lists.some((existing) => existing.id === list.id)
  ) {
    return zone;
  }

  return { ...zone, lists: [...zone.lists, list] };
}

function renameListPreview(zone: MyZone, listId: string, name: string): MyZone {
  if (!zone.lists.some((list) => list.id === listId)) {
    return zone;
  }

  return {
    ...zone,
    lists: zone.lists.map((list) =>
      list.id === listId ? { ...list, name } : list
    ),
  };
}

/**
 * Drop a deleted list from the preview.
 *
 * A zone with four lists showing three now shows two, until the next load refills it.
 * That is accepted: the alternative is asking the server for a fresh preview on every
 * deletion, which is a request per event for a cosmetic third row.
 */
function removeListPreview(zone: MyZone, listId: string): MyZone {
  return {
    ...zone,
    lists: zone.lists.filter((list) => list.id !== listId),
  };
}
