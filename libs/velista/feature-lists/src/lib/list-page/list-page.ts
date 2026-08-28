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
  LineStore,
  ListStore,
  MemberNames,
  presenceNames,
  presencePeople,
  PresenceStore,
  REALTIME_CLIENT,
  SessionStore,
  ZoneStore,
  type RealtimeClientI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type ListGoneReason,
  type ListPageState,
  type ListViewerVm,
  type PresenceUser,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  listIdOf,
  StorageKeys,
  zoneIdOf,
} from '@portfolio/velista/platform';
import {
  AppBar,
  ChevronLeftIcon,
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

    inject(DestroyRef).onDestroy(() => this.announcement.set(''));
  }

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

  /** Back to the group. A destination's back, not a sheet's dismiss. */
  async back(): Promise<void> {
    if (this.reordering()) {
      // Android's back ends the mode rather than leaving the page, which is what makes
      // the mode safe to enter: nothing is lost by getting out of it (rule L4).
      this.endReorder();
      return;
    }

    await this._router.navigateByUrl(
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
   * Tick a line off, or put it back.
   *
   * The gesture the whole screen is built around, and it is `DECIDE` rather than `WRITE`
   * since plan 0030 section 4: saying the tin is in the trolley is deciding, not adding.
   *
   * The guard below is belt on top of braces and is silent. `LineRowVm.interactive`
   * already follows `canDecide`, so a caller who may not tick has rows that emit nothing
   * on a tap, and the sentence explaining that is on screen from the moment the page
   * draws rather than appearing on the first tap. That is the whole of the change: the
   * page used to discover a reader from a refusal and say so once, and now it knows
   * before anybody touches anything (section 3.2).
   */
  async toggle(lineId: string): Promise<void> {
    const line = this._lines
      .linesIn(this.listId())
      .find((l) => l.id === lineId);
    if (line === undefined) {
      return;
    }

    const page = this.loaded();
    if (page !== null && !page.abilities.canDecide) {
      return;
    }

    const next = line.status === 'READY' ? 'PENDING' : 'READY';
    const outcome = await this._lines.setStatus(lineId, next);
    this._afterWrite(outcome, lineId, 'lines.write');
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
      case 'markNotAvailable':
        this._afterWrite(
          await this._lines.setStatus(event.lineId, 'NOT_AVAILABLE'),
          event.lineId,
          'lines.write'
        );
        return;
      case 'markPending':
        this._afterWrite(
          await this._lines.setStatus(event.lineId, 'PENDING'),
          event.lineId,
          'lines.write'
        );
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
  async add(entry: { content: string; quantity: number }): Promise<void> {
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
      }
    );

    this.composerBusy.set(false);

    if (outcome.state === 'failed') {
      this._reportPageError(outcome.error, 'lines.write');
      return;
    }

    this.announcement.set(entry.content);
  }

  /** The inline failure notice was tapped. Retries the write that failed. */
  async retry(lineId: string): Promise<void> {
    this._lines.dismissNote(lineId);
    await this.toggle(lineId);
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
    const current = this.loaded();
    if (current === null) {
      return;
    }

    const ids = current.lines.map((line) => line.id);
    const from = ids.indexOf(lineId);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) {
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
