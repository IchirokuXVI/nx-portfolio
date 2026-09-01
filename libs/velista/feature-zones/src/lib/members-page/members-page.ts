import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  MEMBERSHIP_SERVICE,
  MembershipStore,
  REALTIME_CLIENT,
  SessionStore,
  ZoneStore,
  type MembershipServiceI,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type MemberAction,
  type Membership,
  type MembersState,
} from '@portfolio/velista/models';
import { appPath, PageNavigation, zoneIdOf } from '@portfolio/velista/platform';
import {
  AppBar,
  ChevronLeftIcon,
  ErrorState,
  MemberRow,
  PendingRequestRow,
  RowSkeleton,
} from '@portfolio/velista/ui';
import { canSeePendingRequests, memberActionsFor } from '../member-actions';
import { MemberListRefresh } from '../member-list-refresh';
import { correlationIdOf, zoneErrorKey } from '../zone-error-copy';

/**
 * Who is in the group, and where a request to join finally gets an answer.
 *
 * This screen is why `0010` is one plan and not two. `0008` built both ways into a
 * group and said plainly that it could produce a pending membership and could not
 * resolve one, so an app built to the plans before this one had people standing in a
 * queue that nothing could serve.
 *
 * ## The members list moved into a store (plan 0018)
 *
 * It was page state, and the argument for that was a good one: a cursor paged list
 * scoped to one screen is what plan 0004 calls a page facade, and throwing it away on
 * the way out means coming back shows who is in the group **now**.
 *
 * What it could not survive was the events. Six membership events change these rows and
 * this screen applied one of them, the rename, through a one shot channel on
 * `ZoneStore`; the other five did nothing, so a member kicked while an owner was
 * looking at this screen stayed on it with a working actions menu whose every entry
 * failed against a membership the server had already deleted. Five more one shot
 * channels would have dropped events, since a signal holds only its latest value and
 * departures arrive in bursts.
 *
 * `MembershipStore` holds the rows now and applies all seven, this screen included.
 * The property that argued for page state is kept rather than lost: the load effect
 * below still runs on every arrival, so coming back still asks the server who is in the
 * group, and the store's rows are what fills the screen while that answer is on its way
 * instead of a skeleton.
 *
 * The counts belong to the zone rather than to this list, so approving somebody still
 * tells `ZoneStore` and the group page's member count moves without a reload.
 *
 * ## Rule G3
 *
 * The staff room is joined only when `myRole` says the caller is staff. The server
 * refuses it otherwise, a refusal feeds `staleZoneIds`, and `0003` renders that as
 * "this group is not live" — so subscribing unconditionally would put a permanent and
 * untrue stale badge on every group where the caller is an ordinary member
 * (section 5.3).
 */
@Component({
  selector: 'lib-members-page',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    AppBar,
    ChevronLeftIcon,
    ErrorState,
    MemberRow,
    PendingRequestRow,
    RowSkeleton,
  ],
  templateUrl: './members-page.html',
  styleUrl: './members-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembersPage {
  private readonly _zones = inject(ZoneStore);
  private readonly _members = inject<MembershipServiceI>(MEMBERSHIP_SERVICE);
  private readonly _rowStore = inject(MembershipStore);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _refresh = inject(MemberListRefresh);

  readonly zoneId = zoneIdOf(this._route);

  /**
   * The rows, and how their load is going, both from the store (plan 0018).
   *
   * Read through one `computed` rather than four calls scattered down the file, so the
   * screen reads one consistent answer per turn and the store's shape is named once.
   */
  private readonly _rowState = computed(() =>
    this._rowStore.forZone(this.zoneId())()
  );

  private readonly _rows = computed(() => this._rowState().members);

  /** Rows with a write in flight, so only those go busy and the screen stays usable. */
  private readonly _busy = signal<ReadonlySet<string>>(new Set());

  /** What the live region announces, so a row leaving is not silent (section 7). */
  readonly announcement = signal<{ key: string; name: string } | null>(null);

  /** A failure's copy, as a key. Null for the one failure that must say nothing. */
  readonly errorKey = signal<string | null>(null);

  /**
   * What the screen is called, outside the state union so it is named while it is
   * loading and while it is failing.
   *
   * On a cold deep link there is no cached group to put in "Members of {{name}}", so
   * it falls back to the plain label rather than rendering a sentence with a hole in
   * it. Both keys already exist.
   */
  readonly title = computed(() => {
    const name = this._zones.zoneById(this.zoneId())?.name ?? '';
    return name === ''
      ? { key: 'zone.detail.members', name: '' }
      : { key: 'zone.members.title', name };
  });

  /**
   * Whether the live connection is up, for the app bar's offline mark (plan 0035,
   * section 5.3).
   *
   * Straight off the client rather than through a store: it is a fact about the
   * transport, and every screen that draws the bar reports the same one.
   */
  readonly connected = this._realtime.connected;

  readonly accountInitial = computed(() => {
    const username = this._session.username();
    return username === null ? null : initialOf(username);
  });

  /**
   * The staff subscription, held while this screen is open and released with it.
   *
   * The zone id is kept beside the release, and not as an ornament: this screen is
   * reused across groups, so without it a move from one group to the next went on
   * holding the first group's subscription and never took one on the second.
   */
  private _staffRoom: {
    readonly zoneId: string;
    readonly release: () => void;
  } | null = null;

  readonly state = computed<MembersState>(() => {
    const rowState = this._rowState();

    if (rowState.state === 'failed' && rowState.members.length === 0) {
      return {
        kind: 'error',
        correlationId: correlationIdOf(rowState.error),
      };
    }

    // Rows already loaded beat the spinner, which is the half of the store that pays
    // for itself on the way back into a group: the second visit draws the list it had
    // while the reload is in flight, rather than a skeleton over data it is holding.
    if (rowState.state !== 'loaded' && rowState.members.length === 0) {
      return { kind: 'loading' };
    }

    const zone = this._zones.zoneById(this.zoneId());
    const myRole = zone?.myRole ?? 'MEMBER';
    const myUserId = this._session.userId();
    const busy = this._busy();
    const rows = this._rows();

    return {
      kind: 'loaded',
      groupName: zone?.name ?? '',
      // Absent, not an empty state with a message: a group with nobody waiting should
      // show no section at all (section 3.4).
      pending: rows
        .filter((row) => row.status === 'PENDING')
        .map((row) => ({
          membershipId: row.id,
          name: row.username,
          initial: initialOf(row.username),
          busy: busy.has(row.id),
        })),
      members: rows
        .filter((row) => row.status === 'APPROVED')
        .map((row) => ({
          membershipId: row.id,
          userId: row.userId,
          name: row.username,
          initial: initialOf(row.username),
          role: row.role,
          isYou: myUserId !== null && row.userId === myUserId,
          // The whole of section 5.4, in one pure function. An empty list means the
          // row has no menu at all rather than a disabled one.
          actions: memberActionsFor({
            myRole,
            myUserId,
            member: { userId: row.userId, role: row.role },
          }),
          busy: busy.has(row.id),
        })),
      hasMore: rowState.hasMore,
      loadingMore: rowState.loadingMore,
    };
  });

  constructor() {
    // The screen's one load.
    //
    // Keyed on the group and on the statuses, and on nothing else. Every call in the
    // body writes a signal that the same body reads: `loadZone` upserts into the zone
    // cache, `_load` sets the rows it first measured. Tracking those would schedule
    // this effect again the moment its own requests landed, which is one
    // `GET /v1/zones/{id}` and one members page per turn of a loop that never ends, so
    // the body runs untracked and the two things worth reacting to are read above it.
    //
    // The statuses are the second key because on a deep link the zone is not cached
    // yet, so `myRole` is not known and rule G2 makes this screen ask for APPROVED
    // alone. When the reload lands on a staff member that answer changes, and the
    // pending queue, which is the reason this screen exists, has to be asked for
    // again.
    effect(() => {
      const id = this.zoneId();
      const statuses = this._statuses();
      // The third key: a sheet over this screen changed a row. Read bare, outside
      // `untracked`, alongside the two that were already here.
      this._refresh.token();

      untracked(() => {
        void this._zones.loadZone(id);
        void this._load(id, statuses);
        this._syncStaffRoom(id);
      });
    });

    // A group the caller was removed from, or that was deleted, while this screen was
    // open. Same answer as the group page: leave for the dashboard with a notice.
    effect(() => {
      const departure = this._zones.departure();
      if (departure === null || departure.zoneId !== this.zoneId()) {
        return;
      }

      this._zones.clearDeparture();
      void this._router.navigateByUrl(
        appPath(this._locale(), this._basePath, 'home')
      );
    });

    // The rename effect that used to be here is gone with plan 0018. It was this
    // screen's one live event, patched in from a `ZoneStore` channel; `MembershipStore`
    // now applies it and the five membership events that never had a channel, so the
    // rows are live through one mechanism rather than one row's worth of one.

    // The members screen is a screen about one group, so being on it is being in that
    // group (plan 0023). Separate from the staff room above, and unconditional, because
    // that one is held only for an owner or an admin: presence that depended on the
    // reader's role would light up for staff and leave every ordinary member invisible.
    effect((onCleanup) => {
      const leave = this._realtime.enterZone(this.zoneId());
      onCleanup(leave);
    });

    inject(DestroyRef).onDestroy(() => this._releaseStaffRoom());
  }

  /** Back to wherever this screen was opened from, its group being the usual one. */
  async back(): Promise<void> {
    await this._pages.back(
      appPath(this._locale(), this._basePath, 'zones', this.zoneId())
    );
  }

  /**
   * The app bar's account button, which was inert on this screen until plan 0015
   * (section 4.4).
   */
  async openAccount(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'account')
    );
  }

  /** The assistant (plan 0032). See the note on the group page. */
  async openAssistant(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'assistant')
    );
  }

  /**
   * Let somebody in.
   *
   * The one write on this screen with a **silent** failure. `validation_failed` means
   * the membership is no longer PENDING, which means another admin answered first.
   * Two admins on the same queue is the normal case, and the one who was half a second
   * slower has done nothing wrong: the row leaves, which is what the realtime event
   * was about to do anyway, and nothing is said (section 5.6).
   */
  async approve(membershipId: string): Promise<void> {
    await this._answer(membershipId, 'approved', (zoneId) =>
      this._members.approve(zoneId, membershipId)
    );
  }

  async reject(membershipId: string): Promise<void> {
    await this._answer(membershipId, 'rejected', (zoneId) =>
      this._members.reject(zoneId, membershipId)
    );
  }

  /**
   * A row menu's choice.
   *
   * The three that take something away go through a confirm sheet, and renaming needs
   * a field, so all four are routes over this page (rule E1). A role change is neither:
   * it is one tap, it is reversible by the same person in the same menu, and putting a
   * sheet in front of it would be friction for its own sake (section 5.7).
   */
  async act(event: {
    action: MemberAction;
    membershipId: string;
  }): Promise<void> {
    if (event.action === 'makeAdmin' || event.action === 'makeMember') {
      await this._setRole(
        event.membershipId,
        event.action === 'makeAdmin' ? 'ADMIN' : 'MEMBER'
      );
      return;
    }

    // The name travels in router state so the sheet's title can say it without a
    // second request for something already on screen. A deep link carries none, and
    // the sheet is written to read correctly without it.
    void this._router.navigate([event.membershipId, 'confirm', event.action], {
      relativeTo: this._route,
      state: { name: this._nameOf(event.membershipId) },
    });
  }

  /** Another page of members. Rare, and the screen still has to do it. */
  async loadMore(): Promise<void> {
    try {
      await this._rowStore.loadMore(this.zoneId());
    } catch (error) {
      this.errorKey.set(zoneErrorKey(error, 'zone.read'));
    }
  }

  retry(): void {
    void this._load(this.zoneId());
  }

  private async _answer(
    membershipId: string,
    change: 'approved' | 'rejected',
    send: (zoneId: string) => Promise<unknown>
  ): Promise<void> {
    const zoneId = this.zoneId();
    const name = this._nameOf(membershipId);
    this._setBusy(membershipId, true);
    this.errorKey.set(null);

    try {
      await send(zoneId);
      this._zones.recordMembershipChange(zoneId, change);
      this.announcement.set({
        key:
          change === 'approved'
            ? 'zone.members.approved'
            : 'zone.members.rejected',
        name,
      });
      // Re-read rather than patching in place: approving moves a row from one section
      // to the other, and the server is the thing that knows what the row looks like
      // afterwards.
      await this._load(zoneId);
    } catch (error) {
      const key = zoneErrorKey(error, 'member.answer');
      if (key === null) {
        // Somebody else answered first. The row goes, and nothing is said.
        await this._load(zoneId);
        return;
      }

      this.errorKey.set(key);
    } finally {
      this._setBusy(membershipId, false);
    }
  }

  private async _setRole(
    membershipId: string,
    role: 'ADMIN' | 'MEMBER'
  ): Promise<void> {
    const zoneId = this.zoneId();
    this._setBusy(membershipId, true);
    this.errorKey.set(null);

    try {
      const updated = await this._members.setRole(zoneId, membershipId, role);
      // The same path `member.roleChanged` takes when it arrives from another device,
      // deliberately: two ways into one row is how the two end up differing in the
      // case nobody tests.
      this._rowStore.record(updated);
    } catch (error) {
      this.errorKey.set(zoneErrorKey(error, 'member.govern'));
      // The caller's own role may be what changed. Re-reading the zone is what puts
      // every control drawn from `myRole` back in step with what the server allows.
      void this._zones.loadZone(zoneId);
    } finally {
      this._setBusy(membershipId, false);
    }
  }

  private async _load(
    zoneId: string,
    statuses: readonly Membership['status'][] = this._statuses()
  ): Promise<void> {
    try {
      await this._rowStore.load(zoneId, statuses);
    } catch (error) {
      // The store holds the failure, which is what the error state renders. This is
      // the copy for the inline message, which is a different sentence in a different
      // place, and both are wanted: one for a screen with nothing on it, one for a
      // screen that still has rows.
      this.errorKey.set(zoneErrorKey(error, 'zone.read'));
    }
  }

  /**
   * Which statuses to ask for.
   *
   * **Rule G2.** Anything other than APPROVED is staff only, and asking for it as an
   * ordinary member is a `forbidden` rather than an empty page, so this reads `myRole`
   * instead of finding out by being refused.
   */
  private readonly _statuses = computed<readonly Membership['status'][]>(
    () => {
      const zone = this._zones.zoneById(this.zoneId());
      return canSeePendingRequests(zone?.myRole ?? 'MEMBER')
        ? ['APPROVED', 'PENDING']
        : ['APPROVED'];
    },
    {
      // Compared by value, because the arrays are rebuilt on every read and two fresh
      // arrays are never `Object.is` equal. Without this the load effect above would
      // wake on every write to the zone cache, which is exactly what it must not do.
      equal: (a, b) =>
        a.length === b.length && a.every((status, i) => status === b[i]),
    }
  );

  /**
   * Rule G3. Subscribed with the staff intent for staff, released for everybody else
   * and on destroy.
   *
   * A subscription to the zone carrying `staff: true`, not a subscription to a staff
   * room: the server has no message that joins or leaves `zone:{id}:staff` on its own
   * (plan 0016, section 3.2). So this takes a refcount on the plain zone room too,
   * which it always needed and was getting only because `ZoneStore` happened to hold
   * one for every visible group. A group opened by deep link is not one of those until
   * the dashboard has loaded.
   */
  private _syncStaffRoom(zoneId: string): void {
    const zone = this._zones.zoneById(zoneId);
    const wanted = canSeePendingRequests(zone?.myRole ?? 'MEMBER');

    if (
      this._staffRoom !== null &&
      (!wanted || this._staffRoom.zoneId !== zoneId)
    ) {
      this._releaseStaffRoom();
    }

    if (wanted && this._staffRoom === null) {
      this._staffRoom = {
        zoneId,
        release: this._realtime.subscribeZone(zoneId, { staff: true }),
      };
    }
  }

  private _releaseStaffRoom(): void {
    this._staffRoom?.release();
    this._staffRoom = null;
  }

  private _nameOf(membershipId: string): string {
    return this._rows().find((row) => row.id === membershipId)?.username ?? '';
  }

  private _setBusy(membershipId: string, busy: boolean): void {
    this._busy.update((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(membershipId);
      } else {
        next.delete(membershipId);
      }
      return next;
    });
  }
}

/**
 * The letter in a member's avatar.
 *
 * Code points rather than a slice, because slicing cuts a surrogate pair in half and a
 * name that starts with an emoji would render the replacement character.
 */
function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed === ''
    ? ''
    : (Array.from(trimmed)[0] ?? '').toLocaleUpperCase();
}
