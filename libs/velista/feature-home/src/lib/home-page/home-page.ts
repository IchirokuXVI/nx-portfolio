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
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  AUTH_SERVICE,
  GatewayError,
  hasOthers,
  MemberNames,
  NetworkError,
  presenceNames,
  PresenceStore,
  REALTIME_CLIENT,
  SessionStore,
  VERIFY_RESEND_AVAILABLE,
  ZoneStore,
  type AuthServiceI,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import type {
  HomeState,
  MyZone,
  PresenceUser,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import {
  AppBar,
  AskedNotice,
  BottomActionBar,
  ConfirmEmailNudge,
  EmptyState,
  ErrorState,
  GuestUpgradeBanner,
  InviteCard,
  ResumeListCard,
  SuccessNote,
  ZoneCard,
  ZoneSkeleton,
  type ResendState,
} from '@portfolio/velista/ui';
import { selectHomeState } from './select-home-state';

/**
 * The dashboard: what a signed in user sees at `/<locale>/velista/home`.
 *
 * `0003` made this one adaptive route that rendered a front door or a dashboard
 * depending on authentication state. `0007` split it in two. The reasoning behind the
 * original decision survives, because `anonymousOnlyGuard` sends a signed in visitor
 * here from the mount before anything renders, so a returning user still arrives on
 * their groups in one navigation. What changed is that authentication now decides
 * **where you are** rather than what a `@switch` renders, which makes "signed in users
 * never see the front door" a test instead of an emergent behaviour, and stops this
 * page shipping the hero, the preview card and the auth actions to somebody who will
 * never see them.
 *
 * This is the container, and rule D1 (plan 0004) is what shapes it: it is the only
 * thing here that injects a data token, it holds the page's state, and it passes plain
 * values down to components that know nothing about a backend. Its only presentation
 * logic is choosing which state to render, and even that is delegated to a pure
 * function so it can be tested exhaustively without a fixture.
 */
@Component({
  selector: 'lib-home-page',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    AppBar,
    AskedNotice,
    BottomActionBar,
    ConfirmEmailNudge,
    EmptyState,
    ErrorState,
    GuestUpgradeBanner,
    InviteCard,
    ResumeListCard,
    SuccessNote,
    ZoneCard,
    ZoneSkeleton,
  ],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly _zoneStore = inject(ZoneStore);
  private readonly _presence = inject(PresenceStore);
  private readonly _names = inject(MemberNames);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _session = inject(SessionStore);
  private readonly _accountNotice = inject(AccountNotice);
  private readonly _auth = inject<AuthServiceI>(AUTH_SERVICE);
  private readonly _browser = inject(BrowserFacade);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  /**
   * Dismissal is session state, not persisted: `0003` requires the guest banner not to
   * reappear "within the same session", which is deliberately weaker than never again.
   * Somebody who taps Not now today should be asked again tomorrow, because the risk
   * it warns about has not gone away.
   */
  private readonly _guestBannerDismissed = signal(false);

  private readonly _correlationId = computed(() => {
    const error = this._zoneStore.error();
    return error instanceof GatewayError || error instanceof NetworkError
      ? error.correlationId
      : null;
  });

  /**
   * The list this device last opened, resolved against the zones actually loaded.
   *
   * Stored as `zoneId/listId` since plan 0012, because the list route needs both.
   * A **stored value changing shape** is worth naming: a device that remembers the old
   * form holds a bare list id with no separator, which `selectHomeState` reads as "a
   * list id with no zone" and declines to build a card from. That is a missing card
   * once, on one device, rather than a card that navigates somewhere broken
   * (section 4.1).
   */
  private readonly _resumeListId = signal<string | null>(null);

  /**
   * The remembered list, as `zoneId/listId`, but only once its zone is one of ours.
   *
   * A **string** rather than a pair, and that is what makes it usable in an effect:
   * a computed returning a fresh object would be a new value on every zone reload, so
   * the room below would be left and re-joined every time the dashboard refreshed.
   *
   * The zone check is not a permission check, which is the server's job. It saves a
   * subscription that could only ever be refused, for a list on a device that has since
   * left the group.
   */
  private readonly _presenceListKey = computed<string | null>(() => {
    const stored = this._resumeListId();
    if (stored === null) {
      return null;
    }

    const separator = stored.indexOf('/');
    if (separator < 0) {
      return null;
    }

    const zoneId = stored.slice(0, separator);
    return this._zoneStore.myZones().some((zone) => zone.id === zoneId)
      ? stored
      : null;
  });

  /**
   * Who else is shopping the resume list, named and without the reader.
   *
   * The three joins this and every other presence row on the page make are
   * `presenceNames`, which is where they are explained: the reader is dropped here
   * rather than in the store, a name that will not resolve is left out rather than
   * rendered as an id, and a wire username would win if one ever appeared.
   */
  private readonly _resumeShoppers = computed<readonly string[]>(() => {
    const key = this._presenceListKey();
    if (key === null) {
      return [];
    }

    const separator = key.indexOf('/');
    return this._named(
      key.slice(0, separator),
      this._presence.viewersOf(key.slice(separator + 1))
    );
  });

  /**
   * Who is online in each group, and who is shopping each of its lists, all named.
   *
   * Two maps built in one pass over the zones, because a card's presence and its rows'
   * presence are resolved against the **same** zone: a membership username is a name in
   * that group and nowhere else, so the zone the id came from has to be in scope at the
   * moment the name is looked up.
   *
   * Maps rather than a lookup per card, so the whole dashboard's presence is one pass
   * whenever any of it changes, and `selectHomeState` is handed two plain functions.
   */
  private readonly _presenceNames = computed(() => {
    const zones = new Map<string, readonly string[]>();
    const lists = new Map<string, readonly string[]>();

    for (const zone of this._zoneStore.myZones()) {
      zones.set(
        zone.id,
        this._named(zone.id, this._presence.onlineIn(zone.id))
      );
      for (const list of zone.lists) {
        lists.set(
          list.id,
          this._named(zone.id, this._presence.viewersOf(list.id))
        );
      }
    }

    return { zones, lists };
  });

  /** The three joins, for one zone's worth of presence. */
  private _named(
    zoneId: string,
    users: readonly PresenceUser[]
  ): readonly string[] {
    return presenceNames(users, this._session.userId(), (userId) =>
      this._names.nameOf(zoneId, userId)
    );
  }

  readonly state = computed<HomeState>(() => {
    const identity = this._session.identity();

    // Unreachable through the router: `authenticatedGuard` has already sent an
    // anonymous visitor to the front door before this page is created. It is written
    // out because the signal's type still admits it, and because a session that ends
    // while the page is mounted is a real event. The skeleton is the honest thing to
    // render for the frame before the guard's redirect completes; somebody else's
    // groups is not.
    if (identity.kind === 'anonymous') {
      return { kind: 'loading' };
    }

    return selectHomeState({
      identity,
      zones: this._zoneStore.myZones(),
      loadState: this._zoneStore.state(),
      correlationId: this._correlationId(),
      resumeListId: this._resumeListId(),
      resumeShoppers: this._resumeShoppers(),
      zoneOnline: (zoneId) => this._presenceNames().zones.get(zoneId) ?? [],
      listViewers: (listId) => this._presenceNames().lists.get(listId) ?? [],
      guestBannerDismissed: this._guestBannerDismissed(),
    });
  });

  /**
   * Whether the live connection is up, for the app bar's offline mark (plan 0035,
   * section 5.3).
   *
   * Straight off the client rather than through a store: it is a fact about the
   * transport, and every screen that draws the bar reports the same one.
   */
  readonly connected = this._realtime.connected;

  /**
   * The letter in the app bar's account button.
   *
   * From the global username the token pair now carries (backend plan 0018), so it
   * costs no request. Null falls back to a neutral glyph, which is right for a guest
   * whose pair predates that change rather than showing them somebody else's letter.
   */
  readonly accountInitial = computed(() => {
    const username = this._session.username();
    return username === null
      ? null
      : (Array.from(username)[0] ?? '').toLocaleUpperCase();
  });

  /**
   * What the person just did to arrive here, resolved against the zone it was about.
   *
   * Null in the ordinary case, which is somebody opening their dashboard. It resolves
   * to null as well while the zone is not in the cache yet, which is the join case
   * before its reload lands: the panel names the group, and a panel with a blank name
   * is worse than a panel that appears a moment later (plan 0008, section 5.6).
   *
   * `lastEntry` lives on the store rather than in router state because the screen that
   * starts a way in is not the screen that reports it, and the store is the one thing
   * above both that survives the navigation between them.
   */
  readonly entry = computed<{
    kind: 'created' | 'joined';
    zone: MyZone;
  } | null>(() => {
    const last = this._zoneStore.lastEntry();
    if (last === null) {
      return null;
    }

    const zone = this._zoneStore
      .myZones()
      .find((candidate) => candidate.id === last.zoneId);

    return zone === undefined ? null : { kind: last.kind, zone };
  });

  /**
   * What just happened to the account, which this page reports once (plan 0009).
   *
   * Two shapes and two treatments: a fresh registration gets the dismissible
   * confirm-your-email nudge, and an upgrade gets one line saying the account is
   * secured and naming the address. Both are drawn in the second frame of their
   * artboard, and both are news rather than state, which is why the notice is cleared
   * when this page is destroyed.
   */
  readonly accountNotice = this._accountNotice.notice;

  /** Dismissing the nudge. Only the nudge has a dismiss; the secured line is a line. */
  private readonly _nudgeDismissed = signal(false);

  readonly confirmEmail = computed(() => {
    const notice = this.accountNotice();
    return notice?.kind === 'registered' && !this._nudgeDismissed()
      ? notice.email
      : null;
  });

  readonly securedEmail = computed(() => {
    const notice = this.accountNotice();
    return notice?.kind === 'upgraded' ? notice.email : null;
  });

  /**
   * Whether the nudge offers another send.
   *
   * False until the section 5.8 endpoint lands, and the card is exactly the screen
   * plan 0009 would have shipped anyway without its last sentence.
   */
  readonly resendOffered = VERIFY_RESEND_AVAILABLE;

  readonly resendState = signal<ResendState>('ready');
  readonly resendWaitSeconds = signal<number | null>(null);

  /** Set for a moment after the invite code is copied, which swaps the label. */
  readonly codeCopied = signal(false);

  /**
   * Whether the invite card offers sharing.
   *
   * The Web Share API is a phone's, and a button that opens nothing is worse than one
   * that is absent. Read through `BrowserFacade` (rule D2) rather than off `navigator`.
   */
  readonly canShare = this._browser.window?.navigator.share !== undefined;

  constructor() {
    this._resumeListId.set(this._browser.readStorage(StorageKeys.lastList));
    void this._zoneStore.load();

    // The resume card's one live room (plan 0017, section 7).
    //
    // `subscribeList` and deliberately **not** `viewList`: this page holds the room to
    // watch it, and announcing a view here would put the reader in their own card's
    // sentence. It is also the one place plan 0016's "do not subscribe to a list for
    // updates the zone room already carries" does not apply, because
    // `presence.listUpdated` is published to `list:{id}` alone.
    //
    // The names come from the zone's memberships, since presence carries ids only.
    effect((onCleanup) => {
      const key = this._presenceListKey();
      if (key === null) {
        return;
      }

      const separator = key.indexOf('/');
      const release = this._realtime.subscribeList(key.slice(separator + 1));
      void this._names.ensure(key.slice(0, separator));

      onCleanup(() => release());
    });

    // The names behind the presence rows, asked for only when there is somebody to
    // name (plan 0022, section 3.1).
    //
    // Demand driven, and that is the point: `MemberNames.ensure` is one request per
    // zone, so naming every group on the dashboard unconditionally would cost a request
    // per card on every load to render a row that is usually absent. Presence is
    // advisory and must not be expensive. `ensure` is idempotent, so the zones already
    // asked for cost nothing when somebody else arrives in one of them.
    //
    // **Both kinds of presence count, and the list half is not hypothetical.** Backend
    // `0032` joins a zone subscriber to the presence room of every list in that zone it
    // may read, so `viewersOf` now answers for lists this page never opened, and a
    // shopper who deep linked to a list holds no zone subscription and is therefore in
    // no zone's presence at all. Asking only about `onlineIn` left that card's names
    // unresolved forever, and `presenceNames` drops a name it cannot resolve, so the
    // row silently did not draw while the data for it sat in the store.
    effect(() => {
      const me = this._session.userId();
      const peopled = this._zoneStore
        .myZones()
        .filter(
          (zone) =>
            hasOthers(this._presence.onlineIn(zone.id), me) ||
            zone.lists.some((list) =>
              hasOthers(this._presence.viewersOf(list.id), me)
            )
        )
        .map((zone) => zone.id);

      untracked(() => {
        for (const zoneId of peopled) {
          void this._names.ensure(zoneId);
        }
      });
    });

    // Shown once. Cleared when this page is destroyed rather than by a dismiss
    // control, because there is nothing to decide: the card is about something that
    // just happened, and coming back to the dashboard later is a different visit.
    // Opening a sheet does not destroy this page, since the sheets are its children,
    // so cancelling out of one does not take the card with it.
    inject(DestroyRef).onDestroy(() => {
      this._zoneStore.clearLastEntry();
      // Same reasoning, and the same one-shot: being told an account was just secured
      // is news, and coming back to this URL tomorrow is not the moment for it.
      this._accountNotice.clear();
    });
  }

  dismissNudge(): void {
    this._nudgeDismissed.set(true);
  }

  /**
   * Ask for another confirmation email.
   *
   * Unreachable until `VERIFY_RESEND_AVAILABLE` is true, because the sentence that
   * calls it is not rendered. Rule C3 lives in what happens to the answer: whatever
   * wait the **server** returned is handed to the sentence, and a refusal's wait can be
   * many minutes because the bucket is three per ten of them.
   */
  async resendConfirmation(): Promise<void> {
    const outcome = await this._auth.resendVerification();

    if (outcome.state === 'failed') {
      // Nothing is claimed. The sentence stays on Ready so the person can try again,
      // which is the only useful offer for a send that may not have happened.
      return;
    }

    this.resendWaitSeconds.set(outcome.waitSeconds);
    this.resendState.set(outcome.state);
  }

  /**
   * Copy the join code.
   *
   * Best effort, exactly as the support reference is: the Clipboard API needs a secure
   * context and a user gesture and rejects rather than throwing where it is missing.
   * The label only changes when the write actually succeeded, so the confirmation is
   * never a claim the browser did not back up.
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
   * The URL is built here rather than by the card, because it is an absolute address
   * of this app on this origin, which is a fact about where the app is deployed and
   * not about how an invite looks. Falls back to copying when the share sheet is
   * unavailable or the person dismisses it, which is what makes the button safe to
   * offer at all (plan 0008, section 9).
   */
  shareCode(code: string): void {
    const origin = this._browser.location?.origin ?? '';
    const url = `${origin}${this._router.serializeUrl(
      this._router.createUrlTree(['..', 'join', code], {
        relativeTo: this._route,
      })
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

  retry(): void {
    void this._zoneStore.load();
  }

  dismissGuestBanner(): void {
    this._guestBannerDismissed.set(true);
  }

  /**
   * Copies the support reference.
   *
   * Best effort: the Clipboard API needs a secure context and a user gesture, and it
   * rejects rather than throwing where it is unavailable. The reference is selectable
   * text as well, so a failure here costs nothing (plan 0003, section 7).
   */
  copyReference(reference: string): void {
    void this._browser.window?.navigator.clipboard
      ?.writeText(reference)
      .catch(() => undefined);
  }

  /**
   * The two ways in, as sibling routes of this page (plan 0008, rule E1).
   *
   * `relativeTo` this route, so the URL becomes `home/zones/new` without the locale
   * segment or the app's mount being written down here (extraction contract, item 5).
   */
  createZone(): void {
    void this._router.navigate(['zones', 'new'], { relativeTo: this._route });
  }

  joinZone(): void {
    void this._router.navigate(['zones', 'join'], { relativeTo: this._route });
  }

  /**
   * Securing a guest account, which plan 0009 built.
   *
   * **`auth/upgrade` and never `auth/register`**, and that is rule C2 rather than a
   * preference (plan 0009, section 5.3). Register creates a new user row, so a guest
   * who followed it would fill in a valid form, land on an empty dashboard, and have
   * no way back to groups now owned by an account whose only credential was the token
   * that call replaced. `guestOnlyGuard` is the other half of the same rule.
   *
   * `['..', 'auth', 'upgrade']` because this page's own path is `home`, so the
   * credential screens are its **siblings** rather than its children. The two entry
   * sheets are children and use a bare relative path; this one climbs out first, the
   * same way `shareCode` builds the invite link. Neither the locale nor the mount is
   * written down either way (extraction contract, item 5).
   */
  secureAccount(): void {
    void this._router.navigate(['..', 'auth', 'upgrade'], {
      relativeTo: this._route,
    });
  }

  /**
   * Open a group (plan 0010).
   *
   * `['..', 'zones', id]` because this page's own path is `home`, so the group page is
   * its **sibling** rather than its child, exactly as the credential screens are. The
   * two entry sheets are children and use a bare relative path. Neither the locale nor
   * the mount is written down either way (extraction contract, item 5).
   */
  openZone(zoneId: string): void {
    void this._router.navigate(['..', 'zones', zoneId], {
      relativeTo: this._route,
    });
  }

  /**
   * Answer the people waiting to join, which was the deepest dead end in the product:
   * `0008` could produce a pending membership and nothing could resolve one.
   */
  reviewRequests(zoneId: string): void {
    void this._router.navigate(['..', 'zones', zoneId, 'members'], {
      relativeTo: this._route,
    });
  }

  /**
   * Everything else this page can start, and where each of them currently stops.
   *
   * What is left is starting a list from the dashboard. The two entry actions have gone
   * because `0008` built them, securing an account because `0009` did, opening a group
   * and reviewing its requests because `0010` did, **the account screen because `0015`
   * did**, and **search because `0032` spent it**: the app bar's second button is the
   * assistant now, and search will come back with a plan of its own when there is
   * something to search.
   *
   * They are recorded rather than left unbound so the controls are real, focusable and
   * testable now, and so that connecting each one later is a single line here instead
   * of a hunt through templates.
   */
  readonly pendingRoutes = signal<readonly string[]>([]);

  /**
   * Open a list, from a zone card's row or from the resume card.
   *
   * Both ids, because the list route is `zones/:zoneId/lists/:listId` and there is no
   * `GET /v1/lists/:id` for an id alone to be resolved through (plan 0012, rule L1).
   */
  openList(target: { zoneId: string; listId: string }): void {
    void this._router.navigate(
      ['..', 'zones', target.zoneId, 'lists', target.listId],
      { relativeTo: this._route }
    );
  }

  /**
   * The assistant (plan 0032), in the slot that used to call `_notYetRouted('search')`.
   *
   * `['..', 'assistant']` because this page's own path is `home`, so the panel is its
   * **sibling**, exactly as the account screen and the credential screens are. Neither
   * the locale nor the mount is written down (extraction contract, item 5).
   */
  openAssistant(): void {
    void this._router.navigate(['..', 'assistant'], {
      relativeTo: this._route,
    });
  }

  /**
   * Your account (plan 0015), which the app bar's button has pointed at since `0003`
   * and which nothing was behind until now.
   *
   * `['..', 'account']` because this page's own path is `home`, so the account screen
   * is its **sibling**, exactly as the credential screens and the group page are.
   * Neither the locale nor the mount is written down (extraction contract, item 5).
   */
  account(): void {
    void this._router.navigate(['..', 'account'], {
      relativeTo: this._route,
    });
  }

  /**
   * Records an action whose destination has not been built.
   *
   * Deliberately observable rather than an empty body: a test can assert that a button
   * is wired to the right destination, which is the half of this that will still be
   * true once the routes exist.
   */
  private _notYetRouted(destination: string): void {
    this.pendingRoutes.update((current) => [...current, destination]);
  }
}
