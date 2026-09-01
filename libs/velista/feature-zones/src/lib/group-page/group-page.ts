import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  hasOthers,
  ListStore,
  MemberNames,
  presenceNames,
  PresenceStore,
  REALTIME_CLIENT,
  SessionStore,
  ZoneStore,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type GroupState,
  type PresenceUser,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  PageNavigation,
  zoneIdOf,
} from '@portfolio/velista/platform';
import {
  AppBar,
  ChevronLeftIcon,
  EmptyState,
  ErrorState,
  GroupHeader,
  InviteCard,
  ListRow,
  OwnerlessPanel,
  RowSkeleton,
} from '@portfolio/velista/ui';
import { selectGroupState } from '../select-group-state';
import { correlationIdOf, zoneErrorKey } from '../zone-error-copy';

/**
 * The group: its lists, and the way through to the people in it.
 *
 * Every card on the dashboard used to be a dead end. This is the screen behind it, and
 * it is the container in rule D1's sense: the only thing here that injects a store, it
 * holds the page's state, and it passes plain values down to components that know
 * nothing about a backend. Its one piece of presentation logic, choosing which state to
 * render, is delegated to a pure function so it can be tested without a fixture.
 *
 * ## The zone id is a signal, not a snapshot
 *
 * Read from `paramMap` as a signal rather than from `route.snapshot`, because the
 * router **reuses this component** when navigating from one group to another: a
 * snapshot read once in the constructor would leave the second group rendering the
 * first one's rows under the second one's name.
 *
 * Not `withComponentInputBinding` either, which would be the tidier version of the
 * same thing. This app is mounted by the shell, so the shell's `provideRouter` decides
 * whether route inputs are bound at all, and it does not enable them. A page that
 * depended on it would work in the standalone build and silently receive `undefined`
 * in the one that ships (plan 0001, the extraction contract).
 *
 * ## What it does not request
 *
 * For a membership that is still PENDING it asks for **nothing** beyond the zone it
 * already has. Core answers `forbidden` to both the lists and the members for a caller
 * who is not APPROVED, and firing two requests to be refused twice is how somebody ends
 * up reading an error panel about a situation that is not an error (section 3.3).
 */
@Component({
  selector: 'lib-group-page',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    AppBar,
    ChevronLeftIcon,
    EmptyState,
    ErrorState,
    GroupHeader,
    InviteCard,
    ListRow,
    OwnerlessPanel,
    RowSkeleton,
  ],
  templateUrl: './group-page.html',
  styleUrl: './group-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GroupPage {
  private readonly _zones = inject(ZoneStore);
  private readonly _lists = inject(ListStore);
  private readonly _presence = inject(PresenceStore);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _names = inject(MemberNames);
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _browser = inject(BrowserFacade);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** From the `:zoneId` segment. See the class comment on why it is a signal. */
  readonly zoneId = zoneIdOf(this._route);

  /** Set for a moment after the invite code is copied, which swaps the label. */
  readonly codeCopied = signal(false);

  /**
   * Whether the code on screen is the one that has just replaced an older one.
   *
   * Held here rather than read from the store on every draw, because the store's copy
   * is cleared the moment this page has taken it: the notice belongs to this visit and
   * must not come back when the person navigates away and returns.
   */
  readonly codeIsNew = signal(false);

  /** A failure from claiming an ownerless group, as a key. Null when there is none. */
  readonly claimErrorKey = signal<string | null>(null);
  readonly claiming = signal(false);

  readonly state = computed<GroupState>(() => {
    const id = this.zoneId();
    const zone = this._zones.zoneById(id);
    const lists = this._lists.forZone(id)();

    return selectGroupState({
      zone,
      zoneState: this._zones.zoneState().get(id) ?? 'idle',
      lists: lists.lists,
      listsState: lists.state,
      correlationId:
        correlationIdOf(this._zones.error()) ?? correlationIdOf(lists.error),
      stale: this._zones.staleZoneIds().has(id),
      online: this._online(),
      listViewers: (listId) => this._listViewers().get(listId) ?? [],
    });
  });

  /**
   * Who is in this group right now, named and without the reader.
   *
   * Plan 0022, section 3.1 said this needed no intent, because the server computed
   * zone presence from who holds the zone room and `ZoneStore` holds one per zone
   * already. That was true and it was the defect: `ZoneStore` holds a room for
   * **every** group the caller belongs to, for the whole session, so everybody was
   * reported as being in all of their groups at once and never left any of them. Plan
   * 0023 splits the intent out, and the effect below is this page announcing it. The
   * three joins are still `presenceNames`.
   */
  private readonly _online = computed(() =>
    this._named(this._presence.onlineIn(this.zoneId()))
  );

  /**
   * Who is shopping each of this group's lists, named.
   *
   * This page subscribes to no list and does not have to. Backend `0032` joins a socket
   * that subscribed to a zone to the presence room of every list in it the caller may
   * read, so `presence.listUpdated` arrives for lists this client has never opened and
   * `PresenceStore` applies it exactly as it always has (section 3.3).
   *
   * These are names, so they resolve only for a group whose memberships were asked for.
   * That is the one thing landing `0032` did require of this page, and it is the effect
   * below rather than anything here.
   */
  private readonly _listViewers = computed(() => {
    const named = new Map<string, readonly string[]>();
    for (const list of this._lists.forZone(this.zoneId())().lists) {
      named.set(list.id, this._named(this._presence.viewersOf(list.id)));
    }

    return named;
  });

  private _named(users: readonly PresenceUser[]): readonly string[] {
    const zoneId = this.zoneId();
    return presenceNames(users, this._session.userId(), (userId) =>
      this._names.nameOf(zoneId, userId)
    );
  }

  /**
   * The header, or null when there is nothing to draw one from.
   *
   * Pulled out of the union here rather than narrowed in the template, because an
   * `@else if` chain does not narrow a discriminated union far enough for the compiler
   * to accept `current.header` after the error branch. One `computed` is clearer than
   * repeating the header markup inside five `@if` blocks that each narrow correctly.
   */
  readonly header = computed(() => {
    const current = this.state();
    return current.kind === 'error' ? null : current.header;
  });

  /**
   * Whether to offer the join code.
   *
   * Not to somebody still waiting, since handing out a code to a group you have not
   * been let into yourself would be odd, and not on an ownerless group, where the only
   * thing that matters is whether an admin takes it on.
   *
   * And not to an ordinary member. The code can only be **regenerated** by an owner or
   * an admin, so the invite card is the same governance surface the Settings entry is,
   * and on a member's screen it reads as an invitation to an action that is not theirs.
   * `isStaff` is the fact Settings is drawn from too, so the two appear and disappear
   * together, which is right: they are the two halves of governing a group. Because it
   * comes from `myRole` and nothing else (**rule G2**), this is live — promoted, the
   * card appears; demoted, it goes.
   *
   * This is a UI decision and deliberately not a permission (plan 0020, section 5.1).
   * `ZoneView.joinCode` is still sent to every member, so a member's browser still
   * holds the code and devtools will show it. That is accepted: the code is a low
   * entropy invite string any member could get by asking, and the requirement is that
   * the page not put a governance surface in front of somebody it does not belong to.
   */
  readonly showInvite = computed(() => {
    const kind = this.state().kind;
    if (kind === 'error' || kind === 'pending' || kind === 'ownerless') {
      return false;
    }

    // Read through `header` rather than off the union, because `loading` carries an
    // optional one and there is nothing to decide from until it arrives.
    return this.header()?.isStaff === true;
  });

  /**
   * Whether the invite card offers sharing.
   *
   * The Web Share API is a phone's, and a button that opens nothing is worse than one
   * that is absent. Read through `BrowserFacade` rather than off `navigator`.
   */
  readonly canShare = this._browser.window?.navigator.share !== undefined;

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
    return username === null
      ? null
      : (Array.from(username)[0] ?? '').toLocaleUpperCase();
  });

  /**
   * Whether the lists may be asked for yet.
   *
   * A boolean and not the zone itself, deliberately. `ZoneStore` keeps its cache in one
   * map signal, so every write to any zone hands out a new map and anything reading the
   * zone through it wakes up. Narrowing to the one fact that decides the request means
   * the effect below runs when the answer changes rather than every time the cache is
   * touched, and a `boolean` compares equal to itself where a record does not.
   */
  private readonly _mayLoadLists = computed(() => {
    const zone = this._zones.zoneById(this.zoneId());
    return (
      zone !== undefined &&
      zone.myStatus === 'APPROVED' &&
      zone.status !== 'MARKED_FOR_DELETION'
    );
  });

  constructor() {
    // Reloads when the id changes, which is what makes navigating between two groups
    // correct rather than showing the previous one's rows under the new one's name.
    //
    // **Keyed on the id and nothing else.** `loadZone` upserts what it fetched, which
    // writes the store's cache signal, so an effect that both called it and read the
    // cache would schedule itself again the moment its own request landed: one
    // `GET /v1/zones/{id}` per turn of the loop, forever. The read that the reload
    // needs is inside the call, and everything else this page wants from the cache is
    // in `_mayLoadLists` below.
    effect(() => {
      const id = this.zoneId();
      untracked(() => void this._zones.loadZone(id));
    });

    // The lists are asked for only once the caller is known to be approved, which on a
    // deep link is not true until the reload above lands. That is why this is its own
    // effect rather than a branch in that one: it wants to run again when the answer
    // changes, and the reload must not.
    effect(() => {
      const id = this.zoneId();
      const mayLoad = this._mayLoadLists();

      untracked(() => {
        if (mayLoad && this._lists.stateOf(id) === 'idle') {
          void this._lists.load(id);
        }
      });
    });

    // A new join code was minted by the settings sheet this page sits under. Taken
    // once and cleared, exactly as the dashboard takes `lastEntry`, so the notice
    // belongs to the arrival rather than to every draw of the card.
    effect(() => {
      const zoneId = this._zones.lastCodeChange();
      if (zoneId === null || zoneId !== this.zoneId()) {
        return;
      }

      untracked(() => {
        this._zones.clearLastCodeChange();
        this.codeIsNew.set(true);
      });
    });

    // This page is what makes the caller present in this group (plan 0023).
    //
    // An intent rather than a subscription, and held by a screen rather than a store,
    // because a screen is the only thing that knows where somebody is. It takes the
    // zone room with it, which `ZoneStore` is holding anyway, so the refcount keeps
    // one subscription and this adds the intent riding on it. Released on destroy,
    // which is what navigating away from this group does.
    effect((onCleanup) => {
      const leave = this._realtime.enterZone(this.zoneId());
      onCleanup(leave);
    });

    // The names behind the presence rows, asked for only when there is somebody to
    // name (plan 0022, section 3.1).
    //
    // Demand driven for the dashboard's reason: `MemberNames.ensure` is a request, and
    // presence is advisory, so a screen must not spend one on the chance that somebody
    // turns up. It is idempotent, so the second arrival in a group costs nothing.
    //
    // A viewer on one of this group's lists counts as somebody being here, and has to,
    // now that backend `0032` sends this page list presence for lists it never opened:
    // the row it feeds is drawn from names, `presenceNames` drops the ones it cannot
    // resolve, and only this request resolves them. Gating on `onlineIn` alone left
    // section 3.3's whole indicator dark for the case it was built for, a shopper deep
    // linked to a list who holds no zone subscription and so appears in no zone's
    // presence.
    effect(() => {
      const id = this.zoneId();
      const me = this._session.userId();
      const peopled =
        hasOthers(this._presence.onlineIn(id), me) ||
        this._lists
          .forZone(id)()
          .lists.some((list) =>
            hasOthers(this._presence.viewersOf(list.id), me)
          );

      untracked(() => {
        if (peopled) {
          void this._names.ensure(id);
        }
      });
    });

    // The caller was removed, or the group was deleted, while this page was open.
    // `ZoneStore` has already dropped it from the cache, so the dashboard behind is
    // correct the moment they land on it; all that is left is to leave and say why.
    //
    // **A role change must not navigate.** It arrives as `member.roleChanged`, which
    // updates `myRole` in place and records no departure, so the governance row
    // appears or disappears under the caller and the page stays put (section 3.5).
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
  }

  /** Back to wherever this group was opened from, the dashboard being the usual one. */
  async back(): Promise<void> {
    await this._pages.back(appPath(this._locale(), this._basePath, 'home'));
  }

  /**
   * The app bar's account button, which was inert on this screen until plan 0015
   * (section 4.4).
   *
   * The bar keeps emitting an output rather than taking a `routerLink`, so rule D1 holds
   * and the `ui` library still knows nothing about the route table.
   */
  async openAccount(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'account')
    );
  }

  /** The assistant (plan 0032), where the app bar's search button used to do nothing. */
  async openAssistant(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'assistant')
    );
  }

  openMembers(): void {
    void this._router.navigate(['members'], { relativeTo: this._route });
  }

  openSettings(): void {
    void this._router.navigate(['settings'], { relativeTo: this._route });
  }

  /**
   * Start a list.
   *
   * Offered to a plain member too, and that is not an oversight: `ListService.create`
   * requires only an approved membership, so anybody here really can make the first one
   * (section 5.5).
   */
  newList(): void {
    void this._router.navigate(['lists', 'new'], { relativeTo: this._route });
  }

  /**
   * Take on an ownerless group.
   *
   * The one action anywhere in the product that gets a zone out of
   * `MARKED_FOR_DELETION`, and it is admin only. A `conflict` means another admin got
   * there first, which is a real race and gets its own sentence rather than the
   * generic one.
   */
  async claim(): Promise<void> {
    if (this.claiming()) {
      return;
    }

    this.claiming.set(true);
    this.claimErrorKey.set(null);

    const outcome = await this._zones.claimOwnership(this.zoneId());
    this.claiming.set(false);

    if (outcome.state === 'failed') {
      this.claimErrorKey.set(zoneErrorKey(outcome.error, 'zone.claim'));
      return;
    }

    // Now an ordinary active group with this caller as its owner, so its lists are
    // readable for the first time.
    void this._lists.load(this.zoneId());
  }

  retry(): void {
    void this._zones.loadZone(this.zoneId());
    void this._lists.load(this.zoneId());
  }

  /**
   * The list screen, which now exists (plan 0012).
   *
   * This was a `pendingRoutes` recorder until the list page landed, which is the
   * pattern `HomePage` uses for a destination that has not been built: the rows stay
   * real, focusable and testable, and connecting them is one line. This is that line.
   */
  openList(listId: string): void {
    // Built with `appPath` rather than relatively, like `back()` above: the list page
    // is a sibling of this route and not a child of it, so a relative navigation would
    // have to climb out first and would then be a fact about this route's depth rather
    // than about where the list lives.
    void this._router.navigateByUrl(
      appPath(
        this._locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        listId
      )
    );
  }

  /**
   * Copy the join code.
   *
   * Best effort, exactly as it is on the dashboard: the Clipboard API needs a secure
   * context and a user gesture and rejects rather than throwing where either is
   * missing. The label only changes when the write actually succeeded.
   */
  copyCode(code: string): void {
    void this._browser.window?.navigator.clipboard
      ?.writeText(code)
      .then(() => this.codeCopied.set(true))
      .catch(() => undefined);
  }

  /**
   * Share the invite link.
   *
   * The URL is absolute and is built here rather than by the card, because it is a
   * fact about where this app is deployed and not about how an invite looks. Falls
   * back to copying when the share sheet is unavailable or dismissed.
   */
  shareCode(code: string): void {
    const origin = this._browser.location?.origin ?? '';
    const url = `${origin}${appPath(
      this._locale(),
      this._basePath,
      'join',
      code
    )}`;

    const share = this._browser.window?.navigator.share;
    if (share === undefined) {
      this.copyCode(url);
      return;
    }

    void share
      .call(this._browser.window?.navigator, { url })
      .catch(() => undefined);
  }
}
