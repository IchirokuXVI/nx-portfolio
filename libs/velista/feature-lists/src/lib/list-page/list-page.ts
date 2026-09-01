import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ASSISTANT_SERVICE,
  CATALOG_SERVICE,
  GatewayError,
  LineStore,
  ListStore,
  MemberNames,
  presenceNames,
  presencePeople,
  PresenceStore,
  REALTIME_CLIENT,
  SessionStore,
  ShoppingProfileStore,
  ZoneStore,
  type AssistantServiceI,
  type CatalogServiceI,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  LINE_VOICE_MAX_SECONDS,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  type CatalogSuggestion,
  type ListGoneReason,
  type ListPageState,
  type ListViewerVm,
  type PresenceUser,
  type RecordedAudio,
} from '@portfolio/velista/models';
import {
  appPath,
  AudioRecorder,
  BrowserFacade,
  lineQueryOf,
  listIdOf,
  NOTIFICATION_TONE,
  PageNavigation,
  RECORDING_LIMITS,
  StorageKeys,
  VoicePreferences,
  zoneIdOf,
  type RecordingLimits,
} from '@portfolio/velista/platform';
import {
  AppBar,
  ChevronLeftIcon,
  CloseIcon,
  ErrorState,
  LineComposer,
  LineList,
  ListHeader,
  ListNotice,
  RowSkeleton,
  type LineRowAction,
} from '@portfolio/velista/ui';
import {
  correlationIdOf,
  listErrorEffect,
  listErrorKey,
  type ListOperation,
} from '../list-error-copy';
import { selectListState } from '../select-list-state';

/**
 * The list, its lines, and the aisle. The screen the product exists for.
 *
 * Rule D1's container: the only thing in this library that injects a store, it holds
 * the page's state, and it hands plain values to components that know nothing about a
 * backend. The one piece of real logic, deciding what to draw, is a pure function so it
 * can be tested without a fixture.
 *
 * ## Two requests, neither waiting for the other
 *
 * Rule L2. `GET /v1/lists/:id/lines` needs only the list id; finding the list's **name**
 * means paging `GET /v1/zones/:zoneId/lists`, which on a cold arrival is a second round
 * trip and possibly a third. Sequencing them would make somebody standing in an aisle
 * wait for a heading before they see what to buy. So the header degrades and the body
 * does not, and the two effects below are separate for exactly that reason.
 *
 * ## Rule L3 is the server's now
 *
 * This page used to follow an add by a staff member with an approval of the id that came
 * back, because core started every line PENDING and only a zone OWNER or ADMIN could
 * approve one, so the owner of a two person household added milk and watched it wait for
 * their own approval. Backend plan 0037 section 2 creates the line APPROVED when its
 * author holds `DECIDE`, or when the list auto-approves, so the second call is deleted
 * rather than made conditional: it can no longer be needed, and a client that keeps a
 * corrective write around for a case the server has closed is a client that will
 * eventually perform it against a rule it does not know about.
 *
 * What is left of it is one argument to {@link LineStore.addLine}. The optimistic row
 * has to be drawn with the approval the server is about to give it, from the same two
 * facts the server uses, or the person who typed the line watches an approve button
 * appear on it and vanish (plan 0030, section 5).
 *
 * ## Reorder is a mode, and it is page state
 *
 * The one place this plan does not follow rule E1, and the exception is principled: E1
 * is about screens drawn **over** a page that must not lose the page underneath. A mode
 * does not cover the page, it changes what the page's rows do, and there is nothing to
 * restore on the way back except a flag.
 */
@Component({
  selector: 'lib-list-page',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    AppBar,
    ChevronLeftIcon,
    CloseIcon,
    ErrorState,
    LineComposer,
    LineList,
    ListHeader,
    ListNotice,
    RowSkeleton,
  ],
  templateUrl: './list-page.html',
  styleUrl: './list-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The composer's microphone, with this page's cap on it (plan 0038, section 4).
  //
  // Here rather than in `root`, so leaving the page releases the microphone: a
  // recording does not survive walking away from the list it was about. Thirty
  // seconds, where a comment runs to a minute and the assistant to five, because
  // this is one sentence about a shopping list.
  //
  // `warnAtSeconds` equals the cap on purpose. The warning strip earns its place
  // in the assistant panel at five minutes; a thirty second cap does not, and
  // there is no clock on this row for the same reason (section 4.1).
  providers: [
    AudioRecorder,
    {
      provide: RECORDING_LIMITS,
      useValue: {
        warnAtSeconds: LINE_VOICE_MAX_SECONDS,
        maxSeconds: LINE_VOICE_MAX_SECONDS,
      } satisfies RecordingLimits,
    },
  ],
})
export class ListPage {
  private readonly _zones = inject(ZoneStore);
  private readonly _lists = inject(ListStore);
  private readonly _lines = inject(LineStore);
  private readonly _presence = inject(PresenceStore);
  private readonly _names = inject(MemberNames);
  private readonly _session = inject(SessionStore);
  private readonly _realtime = inject<RealtimeClientI>(REALTIME_CLIENT);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _browser = inject(BrowserFacade);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** Both from the URL, and both signals: the router reuses this component. */
  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);

  readonly reordering = signal(false);

  /** The page's own failure, as a key. Distinct from a per row failure. */
  private readonly _errorKey = signal<string | null>(null);
  private readonly _correlationId = signal<string | null>(null);

  /** Why the page is gone, if it is. */
  private readonly _gone = signal<ListGoneReason | null>(null);

  /**
   * Whether this visit has actually read the zone's lists.
   *
   * The absence of this list from that answer is what "your access was withdrawn"
   * looks like, and absence from a cache nobody has refreshed looks identical. So the
   * page will not draw that conclusion until it has asked.
   */
  private readonly _listsChecked = signal(false);

  /** What the live region is currently saying. Cleared after it has been read. */
  readonly announcement = signal('');

  readonly composerBusy = signal(false);

  private readonly _assistant = inject<AssistantServiceI>(ASSISTANT_SERVICE);
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _tone = inject(NOTIFICATION_TONE);
  private readonly _voice = inject(VoicePreferences);

  /**
   * How the microphone behaves, from the device's own settings.
   *
   * Read here and handed down rather than injected by the composer, because a `ui`
   * component may not reach a store (rule D1): what it takes is two booleans, and it
   * is the page that knows where they come from.
   */
  readonly sendOnSilence = this._voice.sendOnSilence;
  readonly keepListening = this._voice.keepListening;

  /**
   * What was heard and what was done, or null (plan 0038, section 5).
   *
   * One at a time: the next recording replaces this rather than appending to it,
   * because this page is not a chat. Either a sentence the assistant wrote, in
   * `reply`, or one of ours by key, in `messageKey`, never both.
   *
   * `failed` is what the strip is coloured by. The same box carries a confirmation of
   * what was added and the reason nothing was, and those read identically in plain
   * text: somebody who glances at it has to read a sentence to find out which happened.
   * A mishearing counts as a failure, because nothing was added.
   */
  readonly voiceStrip = signal<{
    heard: string;
    reply: string;
    messageKey: string | null;
    messageArgs?: Record<string, string | number>;
    failed: boolean;
  } | null>(null);

  private readonly _column = viewChild<ElementRef<HTMLElement>>('column');

  /**
   * Bumped once per line this reader adds, and read by the render effect that follows
   * the end of the list.
   *
   * A counter and not a boolean, because two adds in a row are the ordinary case here:
   * somebody stands in the kitchen and enters six things, and a flag that is already
   * true does not change, so the effect would run for the first item and never again.
   */
  private readonly _added = signal(0);

  /**
   * The line a chat reply linked to, if the URL carried one (plan 0032, section 8).
   *
   * Empty on every ordinary arrival, which is almost all of them.
   */
  private readonly _requestedLine = lineQueryOf(this._route);

  /** Whichever `?line=` this visit has already dealt with. Not rendered. */
  private readonly _handledLine = signal<string | null>(null);

  /**
   * The row drawn with a ring on it, or null.
   *
   * Separate from `_handledLine` because the two have different lifetimes: the mark
   * fades after a few seconds and the URL does not change, so one signal would either
   * re-mark forever or never mark twice.
   */
  readonly markedLine = signal<string | null>(null);

  readonly state = computed<ListPageState>(() => {
    const listId = this.listId();
    const zoneId = this.zoneId();
    const lines = this._lines.forList(listId)();
    const zone = this._zones.zoneById(zoneId);
    const list = this._lists
      .listsIn(zoneId)
      .find((candidate) => candidate.id === listId);

    return selectListState({
      list,
      zoneName: zone?.name ?? null,
      lines: lines.lines,
      linesState: lines.state,
      linesComplete: lines.complete,
      writes: lines.writes,
      commentCounts: lines.commentCounts,
      // Who is out buying what: read off the lines and moved by `line.claimChanged`
      // on the zone room (backend plan 0052). Both halves matter and the read is the
      // one that was missing: a phone that was asleep while somebody generated a
      // basket draws the same row as one that was watching, where an event only
      // client would be blank until the next thing happened.
      claims: lines.claims,
      // The server's answer, straight through. No zone role, no inference from a refused
      // write, and nothing to reconcile between the two (plan 0030, section 3): staff
      // already arrive holding all four, and a list that has not landed yet answers the
      // empty set, which draws a read-only page for the frame before it does.
      caller: { permissions: list?.myPermissions ?? [] },
      nameOf: (userId) => this._names.nameOf(zoneId, userId),
      reordering: this.reordering(),
      // Both from `PresenceStore`, and both answerable at last: this page announces
      // itself with `viewList` now, so the server's viewer set for this list has
      // somebody in it (plan 0022, sections 2.1 and 3.4).
      viewers: this._viewers(),
      editorOf: (lineId) => this._editors().get(lineId) ?? null,
      // Not live means the room was refused or the connection dropped. What is on
      // screen is correct and will not update itself, which is worth saying: looking
      // live while being stale is worse than looking broken.
      //
      // Keyed on the **zone**, not the list. Nothing subscribes per list, and it does
      // not need to: list and line events are broadcast to the zone room as well
      // (`jetstream.consumer.ts:181-187`), so the zone subscription is what makes this
      // screen live and a refused zone is what makes it stale. Asking about a list room
      // nobody joins could only ever answer no.
      live:
        this._realtime.connected() &&
        !this._realtime.refusedZones().has(zoneId),
      errorKey: this._errorKey(),
      correlationId: this._correlationId(),
      gone: this._gone(),
    });
  });

  /**
   * Who else has this list open, named and without the reader.
   *
   * The three joins are `presencePeople`, which is `presenceNames` with the user id
   * kept: the two lookups below are made **by id**, and matching people back up by
   * their names would put the wrong role on the second Ana in a group with two.
   *
   * Both lookups answer null freely and neither is waited for. The role is null until
   * the zone's members land, and the arrival time is null for anybody first seen in the
   * snapshot being read, which is every viewer on the first frame after a reconnection.
   * The row draws both cases rather than holding the sentence back, because presence is
   * advisory and a row that waited for a role would say nothing for the first second of
   * every visit (plan 0004, section 6.7).
   */
  private readonly _viewers = computed<readonly ListViewerVm[]>(() => {
    const zoneId = this.zoneId();
    const listId = this.listId();

    return presencePeople(
      this._presence.viewersOf(listId),
      this._session.userId(),
      (userId) => this._names.nameOf(zoneId, userId)
    ).map((person) => ({
      userId: person.userId,
      name: person.name,
      role: this._names.roleOf(zoneId, person.userId),
      since: this._presence.viewerSince(listId, person.userId),
    }));
  });

  /**
   * Who is editing which line, named, by line id.
   *
   * One pass rather than an `editorOfLine` per row, so a list of forty lines resolves
   * the handful of editors the server sent instead of searching that array forty times.
   * The server holds one edited line per **socket**, so several people can hold the same
   * one; the last of them wins here, exactly as `editorOfLine` takes the first, because
   * a row has space to name one person.
   */
  private readonly _editors = computed(() => {
    const named = new Map<string, string>();
    for (const editor of this._presence.editorsOf(this.listId())) {
      const [name] = this._named([editor]);
      if (name !== undefined) {
        named.set(editor.lineId, name);
      }
    }

    return named;
  });

  /** The three joins, against this list's zone. */
  private _named(users: readonly PresenceUser[]): readonly string[] {
    const zoneId = this.zoneId();
    return presenceNames(users, this._session.userId(), (userId) =>
      this._names.nameOf(zoneId, userId)
    );
  }

  /** Pulled out so the template narrows once rather than in every branch. */
  readonly header = computed(() => {
    const current = this.state();
    return current.kind === 'error' || current.kind === 'gone'
      ? null
      : current.header;
  });

  readonly loaded = computed(() => {
    const current = this.state();
    return current.kind === 'loaded' ? current : null;
  });

  constructor() {
    // The lines, from the list id alone. Keyed on the id and nothing else, so it runs
    // again when the person navigates from one list to another and never because its
    // own answer landed.
    effect(() => {
      const listId = this.listId();
      untracked(() => {
        this._errorKey.set(null);
        this._gone.set(null);
        void this._loadLines(listId);
      });
    });

    // The name, separately and never in front of the lines (rule L2). It also fills
    // `ListStore` for the group page, so coming back is already warm.
    //
    // The zone's lists are asked for on **every** arrival rather than only when the
    // cache is idle, because this page needs them for a second reason the group page
    // does not have: whether this list is still in the answer is the only way to tell
    // that access was withdrawn (section 3.5). A cache loaded earlier in the session
    // cannot answer that.
    effect(() => {
      const zoneId = this.zoneId();
      untracked(() => {
        void this._zones.loadZone(zoneId);
        void this._checkStillShared(zoneId);
        // The zone's members, for the names on comments and the rows in the share
        // sheet. One request per zone, and it is the only source of a username
        // anywhere in the API (section 5.4).
        void this._names.ensure(zoneId);
      });
    });

    // Both rooms. The list's own, and the **zone's**, because `list.deleted` and
    // `list.accessChanged` are zone events and losing the list while looking at it is
    // a state this page has to render (section 5.3). Refcounted, released on destroy.
    //
    // `viewList` and not `subscribeList`, which is the correction plan 0022 opens with.
    // It takes the same room and returns the same release, and it also says somebody is
    // here: the server refuses a presence intent from a socket that is not in
    // `list:{id}`, so the client holds both as one call. Until this line said `viewList`
    // the server's viewer set for every list was empty forever, which made the resume
    // card's "Ana and Marc are shopping now" row unreachable for a real user.
    //
    // The dashboard's own subscription to the resume list stays `subscribeList`, and
    // must: reading a dashboard is not shopping, and a page that announced it would put
    // every user into whichever list they last opened.
    //
    // `enterZone` and not `subscribeZone`, which is plan 0023's half of the same
    // correction: shopping from a list **is** being in that group, and the zone
    // subscription every group already holds for its live counts cannot say so,
    // because it is held for every group at once from the moment the app loads.
    effect((onCleanup) => {
      const leaveList = this._realtime.viewList(this.listId());
      const leaveZone = this._realtime.enterZone(this.zoneId());
      onCleanup(() => {
        leaveList();
        leaveZone();
      });
    });

    // The list was deleted, or the caller's access to it withdrawn, while this page was
    // open. `ListStore` refetches the zone's lists on `list.accessChanged` already, so
    // the question here is only whether this list is still in the answer.
    //
    // **Gated on having actually asked.** Without `_listsChecked` this reads a cache
    // that has not been refreshed yet and declares the page gone on the frame before
    // the answer arrives, which on a cold arrival is every time.
    effect(() => {
      const zoneId = this.zoneId();
      const listId = this.listId();
      const lists = this._lists.forZone(zoneId)();
      const checked = this._listsChecked();

      untracked(() => {
        if (!checked || lists.state !== 'loaded' || this._gone() !== null) {
          return;
        }

        if (!lists.lists.some((list) => list.id === listId)) {
          // Deleted and unshared are indistinguishable from here, and the copy differs
          // only because one of them is worth naming when the store saw the delete
          // event itself. Absent that, unshared is the safer thing to say: it does not
          // claim something was destroyed.
          this._gone.set('unshared');
        }
      });
    });

    // The last list opened, for the dashboard's resume card. Stored as
    // `zoneId/listId`, because the list route needs both and an id alone resolves
    // nothing: there is no `GET /v1/lists/:id` (section 4.1).
    effect(() => {
      const zoneId = this.zoneId();
      const listId = this.listId();
      untracked(() =>
        this._browser.writeStorage(StorageKeys.lastList, `${zoneId}/${listId}`)
      );
    });

    // The list follows the line this reader just added. `afterRenderEffect` because the
    // row has to be in the DOM before the scroller can be measured, and because it runs
    // in the browser and never on the server (plan 0001, D2).
    //
    // Only after an add of the reader's own. Somebody else's line arriving over the
    // socket leaves the scroll alone: moving the page under a thumb that is reaching for
    // a row is how the wrong thing gets ticked off in an aisle.
    afterRenderEffect(() => {
      // Read, so this runs again for the next thing entered in the same run.
      const added = this._added();
      const column = this._column()?.nativeElement;

      if (added === 0 || column === undefined) {
        return;
      }

      this._scrollToNewest(column);
    });

    // A line a chat reply linked to (plan 0032, section 8). It scrolls that row into
    // view and marks it, and **opens nothing**.
    //
    // `afterRenderEffect` because the row has to exist before it can be found, and it
    // re-runs as the lines land: on a cold arrival the query parameter is known several
    // hundred milliseconds before there is anything to scroll to.
    //
    // An id that matches no row is simply not found, and that one branch covers both
    // cases the plan asks for: a line that was deleted, and one on a list this caller
    // can no longer see. A stale link is inert rather than an error, so the page renders
    // normally and nobody is told off for following a link somebody else sent them.
    afterRenderEffect(() => {
      const wanted = this._requestedLine();
      const column = this._column()?.nativeElement;
      // Read so this runs again when the rows arrive; the value itself is not used.
      this.loaded();

      if (wanted === '' || column === undefined) {
        return;
      }

      untracked(() => {
        if (this._handledLine() === wanted) {
          return;
        }

        const row = Array.from(
          column.querySelectorAll<HTMLElement>('[data-line-id]')
        ).find((candidate) => candidate.dataset['lineId'] === wanted);

        if (row === undefined) {
          return;
        }

        this._handledLine.set(wanted);
        // Centred rather than at the top, because the sticky composer covers the
        // bottom of the column and a row revealed against the top edge of a list this
        // long is a row somebody then has to look for anyway.
        // Optional call: `scrollIntoView` is absent in jsdom and in a server render,
        // and the mark is worth setting either way. Nothing here is load bearing
        // enough to fail a navigation over.
        row.scrollIntoView?.({ block: 'center', behavior: 'auto' });
        this.markedLine.set(wanted);
        this._markTimer = setTimeout(
          () => this.markedLine.set(null),
          MARK_DURATION_MS
        );
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.announcement.set('');
      if (this._markTimer !== null) {
        clearTimeout(this._markTimer);
      }
    });
  }

  private _markTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Put the end of the list on screen.
   *
   * Which element scrolls depends on where the app is running, and the page cannot
   * assume: mounted in the portfolio shell the column has a definite height and is the
   * scroll container, standalone nothing above it sets one and the document scrolls
   * instead (`list-page.scss` says why). So ask the column whether it overflows and fall
   * back to the document, rather than picking one and being wrong in half the builds.
   *
   * Scrolling to the very end rather than bringing the row into view: at the end of the
   * scroll the sticky composer has settled into its own place in the flow, so the newest
   * line is directly above it. Anywhere short of that the composer floats over the last
   * few pixels of the column and the row it was asked to reveal is the row behind it.
   */
  private _scrollToNewest(column: HTMLElement): void {
    const scroller =
      column.scrollHeight > column.clientHeight
        ? column
        : this._browser.document.scrollingElement;

    scroller?.scrollTo({
      top: scroller.scrollHeight,
      // Instant. The row appeared on the same frame and it is one row away, so an
      // animation here is a delay before somebody can type the next item, and this
      // field is built for entering six things in a row.
      behavior: 'auto',
    });
  }

  /**
   * Back to wherever this list was opened from, which on the dashboard's own rows is
   * the dashboard and not this list's group.
   */
  async back(): Promise<void> {
    if (this.reordering()) {
      // Android's back ends the mode rather than leaving the page, which is what makes
      // the mode safe to enter: nothing is lost by getting out of it (rule L4).
      this.endReorder();
      return;
    }

    await this._pages.back(
      appPath(this._locale(), this._basePath, 'zones', this.zoneId())
    );
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

  /**
   * The assistant (plan 0032), which is what the app bar's second button now does.
   *
   * It was `(openSearch)`, unbound here and on two other pages, because there was
   * never a search page behind it. `appPath` and not a relative navigation for the
   * reason `openAccount` uses it: this page sits four segments below the mount, and a
   * sibling of the mount is not a relative distance worth writing down.
   */
  async openAssistant(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'assistant')
    );
  }

  /**
   * Whether the live connection is up, for the app bar's offline mark (plan 0035,
   * section 5.3).
   *
   * The header's own `live` is **not** this: that one is about this list, and it is
   * false when the zone room was refused while the socket is perfectly fine. The mark
   * is about the connection and the notice is about the screen, so both are drawn and
   * neither is a duplicate of the other.
   */
  readonly connected = this._realtime.connected;

  /**
   * The letter in the app bar's account button.
   *
   * Unbound on this screen until plan 0015, so the button drew its neutral glyph on the
   * one page somebody spends the longest on.
   */
  readonly accountInitial = computed(() => {
    const username = this._session.username();
    if (username === null) {
      return null;
    }

    // Code points rather than a slice, because slicing cuts a surrogate pair in half
    // and a name that starts with an emoji would render the replacement character.
    const trimmed = username.trim();
    return trimmed === ''
      ? null
      : (Array.from(trimmed)[0] ?? '').toLocaleUpperCase();
  });

  /**
   * A row was tapped, which opens what the app knows about the line.
   *
   * It used to tick the line off, and section 5.1 is the whole of the change: the tap
   * is no longer a decision, so it no longer follows `DECIDE`. Anybody holding `READ`
   * opens the sheet, because knowing is not deciding, and what the sheet offers inside
   * it is decided there from the same abilities.
   *
   * A route rather than a template flag, like every other sheet over this page: rule E1
   * from `0008`, so Android's back button dismisses it (`0012`, section 4.2).
   */
  openLine(lineId: string): void {
    if (this.reordering()) {
      return;
    }

    void this._openSheet(['lines', lineId, 'detail']);
  }

  /**
   * One settled adjustment of a line's quantity, as a signed delta.
   *
   * **The primary gesture of the page** (velista plan 0043, section 4). The reel has
   * already snapped, already waited out its idle beat, and already collapsed however
   * many drags happened inside that window into one number, so this is called once per
   * adjustment rather than once per step.
   *
   * The guard is silent and is belt on top of braces: `LineRowVm.adjustable` follows
   * `canDecide`, so a caller who may not change the number has a reel that does not
   * move, and the sentence explaining that is on screen from the moment the page draws
   * rather than appearing after a refusal (section 3.2).
   */
  async changeQuantity(event: {
    lineId: string;
    delta: number;
  }): Promise<void> {
    const page = this.loaded();
    if (page !== null && !page.abilities.canDecide) {
      return;
    }

    const outcome = await this._lines.addQuantity(event.lineId, event.delta);
    this._afterWrite(outcome, event.lineId, 'lines.write');

    if (outcome === 'succeeded') {
      // Announced **once**, as the settled result, and not per step of the drag
      // (section 7). The reel's own `aria-valuenow` is what a keyboard user hears as
      // they go; this is for the pointer path, where nothing else says out loud that
      // the number moved.
      const line = this._lines
        .linesIn(this.listId())
        .find((candidate) => candidate.id === event.lineId);
      if (line !== undefined) {
        this.announcement.set(
          this._translator.t('list.line.quantityChanged', undefined, undefined, {
            name: line.content,
            quantity: line.quantity,
          })
        );
      }
    }
  }

  /** Everything the row's overflow, decision buttons and grip emit. */
  async act(event: { action: LineRowAction; lineId: string }): Promise<void> {
    switch (event.action) {
      case 'edit':
        void this._openSheet(['lines', event.lineId, 'edit']);
        return;
      case 'comments':
        void this._openSheet(['lines', event.lineId, 'comments']);
        return;
      case 'delete':
        void this._openSheet(['lines', event.lineId, 'confirm', 'delete']);
        return;
      case 'approve':
        this._afterWrite(
          await this._lines.setApproval(event.lineId, 'APPROVED'),
          event.lineId,
          'lines.decide'
        );
        return;
      case 'reject':
        this._afterWrite(
          await this._lines.setApproval(event.lineId, 'REJECTED'),
          event.lineId,
          'lines.decide'
        );
        return;
      case 'restore':
        this._afterWrite(
          await this._lines.setApproval(event.lineId, 'APPROVED'),
          event.lineId,
          'lines.decide'
        );
        return;
      case 'moveUp':
        await this._move(event.lineId, -1);
        return;
      case 'moveDown':
        await this._move(event.lineId, 1);
        return;
    }
  }

  /**
   * Add a line.
   *
   * One call, and no correction after it. The server decides the new line's approval
   * from the adder's `DECIDE` and the list's `autoApproveLines` (backend plan 0037,
   * section 2), and those are the two facts handed down here so the optimistic row is
   * drawn the way the response is about to come back. Getting this wrong is not a stale
   * row, it is an approve button flashing on somebody's own line for one frame, which is
   * the defect plan 0030 section 5 exists to remove.
   */
  async add(entry: {
    content: string;
    quantity: number;
    itemIds?: readonly string[];
  }): Promise<void> {
    const current = this.loaded();
    this.composerBusy.set(true);

    // Before the call, not after it. `addLine` puts the optimistic row on screen
    // synchronously and only then goes to the network, so both land in one change
    // detection pass and the list follows the new row on the frame it appears rather
    // than a round trip later.
    this._added.update((count) => count + 1);

    const outcome = await this._lines.addLine(
      this.listId(),
      entry.content,
      entry.quantity,
      this._session.userId() ?? '',
      {
        canDecide: current?.abilities.canDecide ?? false,
        autoApproveLines: current?.autoApproveLines ?? false,
      },
      // Whatever the composer attached: a group's whole set, one product, or nothing
      // at all for free text, which stays first class (section 6).
      entry.itemIds
    );

    // The list the suggestions were for has been added. Clearing here rather than in
    // the composer keeps the two from disagreeing about whether a dropdown is open.
    this._suggestQuery.set('');
    this.composerBusy.set(false);

    if (outcome.state === 'failed') {
      this._reportPageError(outcome.error, 'lines.write');
      return;
    }

    this.announcement.set(entry.content);
  }

  /**
   * Somebody said what they needed (plan 0038).
   *
   * The recording goes to the **list scoped** assistant route with this page's
   * zone and list on it, so the turn never has to work out which list anybody
   * meant and cannot touch anything else (backend `0044`).
   *
   * **The lines themselves arrive on their own.** The assistant writes through
   * the gateway with the caller's token, core emits the ordinary line events, and
   * this page is in the room, so new rows appear through exactly the path a line
   * added from another phone already takes. Nothing here merges the response into
   * the list, and nothing here may: two paths writing the same row is how a
   * duplicate appears and then disappears.
   */
  async addAloud(recording: RecordedAudio): Promise<void> {
    const zoneId = this.zoneId();
    const listId = this.listId();
    if (zoneId === null || listId === null) {
      return;
    }

    // A sound, because the eyes are the sense that is busy. The microphone stays open
    // through a pause now, so the moment a sentence is taken is no longer marked by the
    // row changing back: somebody holding a fridge door open and looking into it has
    // nothing on screen telling them the last thing they said was heard. The tone is
    // played here rather than in the composer because this is the line that sends, and
    // announcing a delivery that has not been attempted would be a lie somebody acts
    // on by staying quiet.
    this._tone.play();

    this.composerBusy.set(true);
    this.voiceStrip.set(null);

    try {
      const reply = await this._assistant.askAboutList(
        zoneId,
        listId,
        recording.blob
      );

      this.voiceStrip.set(
        reply.heard === ''
          ? {
              heard: '',
              reply: '',
              messageKey: 'list.add.notHeard',
              failed: true,
            }
          : {
              heard: reply.heard ?? '',
              reply: reply.text,
              messageKey: null,
              failed: false,
            }
      );
    } catch (error) {
      // Everything is said in the strip, in words. Nothing here is a banner or a
      // dialog (plan 0038, section 6), and a rate limit counts down in seconds
      // because that is the one failure with a number worth showing.
      const wait =
        error instanceof GatewayError && error.code === 'rate_limited'
          ? error.retryAfterSeconds
          : undefined;
      this.voiceStrip.set({
        heard: '',
        reply: '',
        messageKey:
          wait === undefined ? 'list.add.voiceFailed' : 'list.add.voiceBusy',
        messageArgs: wait === undefined ? undefined : { count: wait },
        failed: true,
      });
    } finally {
      this.composerBusy.set(false);
    }
  }

  /** The microphone did not start. Two sentences, because they read differently. */
  onRecordingFailed(): void {
    this.voiceStrip.set({
      heard: '',
      reply: '',
      messageKey: 'list.add.micRefused',
      failed: true,
    });
  }

  dismissVoice(): void {
    this.voiceStrip.set(null);
  }

  /**
   * What the composer offers, after three characters and a beat (section 6).
   *
   * The debounce is **here** rather than in the composer, because how often a request
   * may be made is not a question a text field can answer, and a timer per component
   * would become two the moment anything else wanted suggestions.
   *
   * Three characters, because one or two match most of a supermarket and the list that
   * comes back is noise under a field somebody is still typing into.
   */
  readonly suggestions = signal<readonly CatalogSuggestion[]>([]);

  /** The last thing typed, which the effect below watches. */
  private readonly _suggestQuery = signal('');

  onComposerQuery(query: string): void {
    this._suggestQuery.set(query);

    // The profiles, read once and only when somebody actually starts typing a product.
    // Not in the constructor: this page is opened far more often than the catalog is
    // searched, and the profile is wanted only when it is. The store is app scoped, so
    // a person who has opened the profiles page or the generation sheet pays nothing.
    if (!this._profilesAsked && query.trim().length >= SUGGEST_MIN_CHARS) {
      this._profilesAsked = true;
      void this._profiles.load();
    }
  }

  /** Whether this page has already asked for the profiles. See {@link onComposerQuery}. */
  private _profilesAsked = false;

  /**
   * Ask the catalog, at most once per {@link SUGGEST_DEBOUNCE_MS} of quiet.
   *
   * The **sequence number** is what makes this correct rather than merely debounced:
   * two requests can be in flight when somebody types through the beat, and they can
   * answer out of order, so an older answer must not be allowed to replace a newer
   * one. Comparing against the query the effect was started for is not enough, since
   * the same text can be typed twice.
   */
  private _suggestSeq = 0;

  private readonly _suggestEffect = effect((onCleanup) => {
    const query = this._suggestQuery().trim();

    if (query.length < SUGGEST_MIN_CHARS) {
      // Cleared synchronously rather than after the debounce: a dropdown that lingered
      // over a field somebody has just emptied is offering matches for nothing.
      untracked(() => this.suggestions.set([]));
      return;
    }

    const timer = setTimeout(() => {
      const seq = (this._suggestSeq += 1);
      // **Scoped to where you shop** (velista plan 0047, section 3). The rule was
      // documented on `CatalogServiceI.suggest` and in plan 0043 section 6, implemented
      // in `CatalogApi`, and passed by nobody, which is the worst of the three states
      // to be in: a reader of either document concluded it worked.
      //
      // The active profile, from the same store the profiles page writes. Nothing when
      // none resolves, which is the documented honest behaviour for somebody who has
      // set no profile up and is what the server already expects.
      const profileId = this._profiles.selected()?.id;
      void this._catalog
        .suggest(query, profileId === undefined ? undefined : { profileId })
        .then((found) => {
          if (seq === this._suggestSeq) {
            this.suggestions.set(found);
          }
        });
    }, SUGGEST_DEBOUNCE_MS);

    onCleanup(() => clearTimeout(timer));
  });

  /**
   * The inline failure notice was tapped.
   *
   * It **opens the line** rather than repeating the write, and that is a change of
   * meaning rather than a change of target. The failed write used to be a tick, which
   * is one gesture with one obvious repeat; it is now a quantity adjustment whose
   * delta this page no longer holds, and re-sending a guessed one would move the number
   * by an amount nobody asked for a second time.
   *
   * So the notice clears and the sheet opens, where the number is on screen and can be
   * set deliberately. Tapping a failure to see what happened is the honest reading of
   * the gesture anyway.
   */
  retry(lineId: string): void {
    this._lines.dismissNote(lineId);
    this.openLine(lineId);
  }

  dismissNote(lineId: string): void {
    this._lines.dismissNote(lineId);
  }

  startReorder(): void {
    this.reordering.set(true);
    this.announcement.set(this._translator.t('list.reorder.started'));
  }

  endReorder(): void {
    this.reordering.set(false);
    this.announcement.set(this._translator.t('list.reorder.ended'));
  }

  openSettings(): void {
    void this._openSheet(['settings']);
  }

  retryLoad(): void {
    this._errorKey.set(null);
    void this._loadLines(this.listId());
  }

  /** Where a gone page sends its reader: back to the group, with the copy for it. */
  async leave(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, 'zones', this.zoneId())
    );
  }

  /**
   * Read the zone's lists, and only then let the page conclude anything from them.
   *
   * `load` on a cold cache and `refresh` on a warm one: `refresh` keeps what is on
   * screen rather than dropping the group page's rows back to a skeleton behind this
   * page, which is `ListStore`'s own distinction and the right one here too.
   */
  private async _checkStillShared(zoneId: string): Promise<void> {
    this._listsChecked.set(false);

    if (this._lists.stateOf(zoneId) === 'idle') {
      await this._lists.load(zoneId);
    } else {
      await this._lists.refresh(zoneId);
    }

    this._listsChecked.set(true);
  }

  private async _loadLines(listId: string): Promise<void> {
    await this._lines.load(listId);

    const error = this._lines.errorOf(listId);
    if (error === null) {
      return;
    }

    this._reportPageError(error, 'lines.read');
  }

  /**
   * One step of a keyboard reorder, and the sentence that announces it.
   *
   * The grip's equivalent, and not optional: a control that only answered a pointer
   * would put the manual order out of reach of anybody without a working one. Each step
   * is a whole reorder, which is what the endpoint takes, and it is cheap because the
   * client already holds every line.
   */
  private async _move(lineId: string, by: number): Promise<void> {
    await this._reorder(lineId, (from) => from + by);
  }

  /**
   * A drag on the grip that ended somewhere else.
   *
   * The finished index and not each row it passed over, because `line.reorder` takes
   * the whole order: a drag across four rows is one request rather than four, and the
   * orders it passed through on the way were never anything anybody asked for.
   */
  async moveTo(move: { lineId: string; to: number }): Promise<void> {
    await this._reorder(move.lineId, () => move.to);
  }

  /**
   * Both ways of moving a line, which differ only in how the destination is worked out.
   *
   * Sharing this is the point: the keyboard path and the drag path have to produce the
   * same request and the same sentence, and a second copy of the splice is a second
   * place for the announcement to go stale.
   */
  private async _reorder(
    lineId: string,
    destination: (from: number) => number
  ): Promise<void> {
    const current = this.loaded();
    if (current === null) {
      return;
    }

    const ids = current.lines.map((line) => line.id);
    const from = ids.indexOf(lineId);
    if (from < 0) {
      return;
    }

    const to = destination(from);
    if (to < 0 || to >= ids.length || to === from) {
      return;
    }

    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, lineId);

    const outcome = await this._lines.reorder(this.listId(), next);
    if (outcome === 'failed') {
      // Silent, and the list has already reread itself. Somebody deleted a line mid
      // drag, and the person who dragged has done nothing wrong (section 5.7).
      return;
    }

    this.announcement.set(
      this._translator.t('list.line.movedTo', undefined, undefined, {
        position: to + 1,
        total: ids.length,
      })
    );
  }

  /**
   * What a per row write outcome does to the page.
   *
   * `overwritten` and `failed` are drawn on the row itself and need nothing here: the
   * store holds the note and `selectListState` puts it on the view model. What this is
   * for is the case where the failure means the page is **wrong about the caller**, and
   * has to change shape rather than show a sentence.
   */
  private _afterWrite(
    outcome: 'succeeded' | 'failed' | 'overwritten',
    lineId: string,
    operation: ListOperation
  ): void {
    if (outcome !== 'failed') {
      return;
    }

    const error = this._lines.errorOf(this.listId());
    this._applyEffect(error, operation);
  }

  private _reportPageError(error: unknown, operation: ListOperation): void {
    if (this._applyEffect(error, operation)) {
      return;
    }

    const key = listErrorKey(error, operation);
    if (key === null) {
      return;
    }

    if (operation === 'lines.read') {
      this._errorKey.set(key);
      this._correlationId.set(correlationIdOf(error));
      return;
    }

    this.announcement.set(this._translator.t(key));
  }

  /** Applies the structural half of a failure. True when it handled the failure. */
  private _applyEffect(error: unknown, operation: ListOperation): boolean {
    switch (listErrorEffect(error, operation)) {
      case 'gone':
        this._gone.set('unshared');
        return true;
      case 'reread':
        void this._lines.refresh(this.listId());
        return true;
      default:
        return false;
    }
  }

  private _openSheet(path: readonly string[]): Promise<boolean> {
    return this._router.navigate([...path], { relativeTo: this._route });
  }
}

/**
 * How long the row a chat link pointed at stays marked.
 *
 * Long enough to be found by somebody who looks up slowly, and short enough that it
 * does not read as a state of the line: the mark says "this is the one you asked
 * about", and a ring that stayed would start saying something about the item itself.
 */
const MARK_DURATION_MS = 4000;
