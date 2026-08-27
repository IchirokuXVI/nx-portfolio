import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ListStore,
  SessionStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type GroupState } from '@portfolio/velista/models';
import { appPath, BrowserFacade } from '@portfolio/velista/platform';
import {
  AppBar,
  EmptyState,
  ErrorState,
  GroupHeader,
  InviteCard,
  ListRow,
  OwnerlessPanel,
  RowSkeleton,
} from '@portfolio/velista/ui';
import { zoneIdOf } from '../route-params';
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
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _browser = inject(BrowserFacade);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** From the `:zoneId` segment. See the class comment on why it is a signal. */
  readonly zoneId = zoneIdOf(this._route);

  /** Set for a moment after the invite code is copied, which swaps the label. */
  readonly codeCopied = signal(false);

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
    });
  });

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
   */
  readonly showInvite = computed(() => {
    const kind = this.state().kind;
    return kind !== 'error' && kind !== 'pending' && kind !== 'ownerless';
  });

  /**
   * Whether the invite card offers sharing.
   *
   * The Web Share API is a phone's, and a button that opens nothing is worse than one
   * that is absent. Read through `BrowserFacade` rather than off `navigator`.
   */
  readonly canShare = this._browser.window?.navigator.share !== undefined;

  readonly accountInitial = computed(() => {
    const username = this._session.username();
    return username === null
      ? null
      : (Array.from(username)[0] ?? '').toLocaleUpperCase();
  });

  constructor() {
    // Reloads when the id changes, which is what makes navigating between two groups
    // correct rather than showing the previous one's rows under the new one's name.
    effect(() => {
      const id = this.zoneId();
      void this._zones.loadZone(id);

      // The lists are asked for only once the caller is known to be approved. The
      // check reads the cache rather than waiting on the load above: arriving from the
      // dashboard the answer is already there, and a deep link's `loadZone` will run
      // this effect again when it lands.
      const zone = this._zones.zoneById(id);
      if (
        zone !== undefined &&
        zone.myStatus === 'APPROVED' &&
        zone.status !== 'MARKED_FOR_DELETION' &&
        this._lists.stateOf(id) === 'idle'
      ) {
        void this._lists.load(id);
      }
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

  /** Back to the dashboard. A destination's back, not a sheet's dismiss. */
  async back(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'home')
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
   * The list screen, which does not exist yet.
   *
   * Recorded rather than left unbound, exactly as `HomePage` does it, so the rows are
   * real, focusable and testable now and connecting them later is one line here.
   */
  readonly pendingRoutes = signal<readonly string[]>([]);

  openList(listId: string): void {
    this.pendingRoutes.update((current) => [...current, `lists/${listId}`]);
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
