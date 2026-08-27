import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  AUTH_SERVICE,
  GatewayError,
  NetworkError,
  SessionStore,
  VERIFY_RESEND_AVAILABLE,
  ZoneStore,
  type AuthServiceI,
} from '@portfolio/velista/data-access';
import type { HomeState, MyZone } from '@portfolio/velista/models';
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
      guestBannerDismissed: this._guestBannerDismissed(),
    });
  });

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
   * What is left leads to the shopping list, which is the next plan, and to the account
   * screen, which is later still. The two entry actions have gone because `0008` built
   * them, securing an account because `0009` did, and opening a group and reviewing its
   * requests because `0010` did.
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

  newList(): void {
    this._notYetRouted('lists.create');
  }

  search(): void {
    this._notYetRouted('search');
  }

  account(): void {
    this._notYetRouted('account');
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
