import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ASSISTANT_SERVICE,
  type AssistantServiceI,
  CATALOG_SERVICE,
  type CatalogServiceI,
  type DroppedWrite,
  DroppedWrites,
  DueLineStore,
  ItemNames,
  LineStore,
  LIST_SERVICE,
  type ListServiceI,
  ListStore,
  type ListViewSnapshot,
  ListViewStore,
  listWritesPage,
  MemberNames,
  presenceNames,
  presencePeople,
  PresenceStore,
  ProductPickStore,
  REALTIME_CLIENT,
  type RealtimeClientI,
  SessionStore,
  ShoppingProfileStore,
  TripStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  type CatalogSuggestion,
  DUE_LINE_ADDS_ON_STEP,
  type Line,
  LINE_VOICE_MAX_SECONDS,
  lineName,
  type LineName,
  type LineRowVm,
  type ListPageState,
  type ListViewerVm,
  NO_CATEGORY,
  type PresenceUser,
  productSuggestions,
  type RecordedAudio,
  reorderWithinSlots,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  tripKey,
} from '@portfolio/velista/models';
import {
  AppHistory,
  appPath,
  AppResumed,
  AudioRecorder,
  BrowserFacade,
  ColumnScroll,
  formatMoney,
  lineQueryOf,
  listIdOf,
  ListSearchNavigation,
  NavChrome,
  NOTIFICATION_TONE,
  PageNavigation,
  PageReturn,
  productPagePath,
  productPickPath,
  productsPickPath,
  RECORDING_LIMITS,
  type RecordingLimits,
  searchOpenOf,
  sheetSegments,
  StorageKeys,
  TourAnchor,
  zoneIdOf,
} from '@portfolio/velista/platform';
import {
  CloseIcon,
  DueLineRow,
  ErrorState,
  FilterIcon,
  GearIcon,
  LineComposer,
  LineList,
  type LineRowAction,
  ListHeader,
  ListNotice,
  PageHeader,
  PageHeaderAction,
  productBrandSizeText,
  RowSkeleton,
  SpinnerIcon,
  type SuggestionChoice,
  type SuggestionHolding,
  type SuggestionHoldingChange,
  SuggestionList,
  ToBuyHeading,
  TripGroup,
} from '@portfolio/velista/ui';
import {
  correlationIdOf,
  listErrorEffect,
  listErrorKey,
  type ListOperation,
} from '../list-error-copy';
import { selectDueLines } from '../select-due-lines';
import { type ListStateCatalog, selectListState } from '../select-list-state';
import { selectTripGroups } from '../select-trip-groups';
import { voiceFailureCopy } from '../voice-error-copy';

/** What the list page hands the catalog that chooses a product, to know its answer. */
const LIST_ROW_PICK = 'list-row';

/**
 * How long after the app comes back a reconnect counts as the same return
 * (velista `0145`): the resume already read every product, and the socket that
 * died in the background comes back a few seconds after it.
 */
const RECONNECT_AFTER_RESUME_MS = 15_000;

interface ListRowPick {
  readonly from: typeof LIST_ROW_PICK;
}

/**
 * What the page was showing when somebody left it for another page, handed back
 * when they come back to it (`PageReturn`).
 */
interface ListPageReturn {
  readonly view: ListViewSnapshot;
  /** The words in the field, put back only onto an entry whose search is open. */
  readonly words: string;
  readonly dueExpanded: boolean;
  readonly scrollTop: number;
}

/** One list's place, so another list on this same page never takes it. */
function listReturnKey(listId: string): string {
  return `list:${listId}`;
}

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
    CloseIcon,
    DueLineRow,
    ErrorState,
    FilterIcon,
    GearIcon,
    LineComposer,
    LineList,
    ListHeader,
    ListNotice,
    PageHeader,
    PageHeaderAction,
    RowSkeleton,
    SpinnerIcon,
    SuggestionList,
    ToBuyHeading,
    TourAnchor,
    TripGroup,
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
  //
  // `DueLineStore` is here too, and not on the route beside `TripStore`: nothing but this
  // page reads it, and a component's injector is destroyed with the page, so the store
  // gives its list back without a teardown call (velista `0089`, section 3).
  providers: [
    DueLineStore,
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

  /**
   * What this screen shows of the list: the search, the order and one category
   * (velista `0082`). Route provided, so the filter sheet reaches the same instance.
   */
  private readonly _view = inject(ListViewStore);

  /** The products on the lines, for their categories, names and prices (section 3). */
  private readonly _itemNames = inject(ItemNames);

  /** Bumped when the app or the socket comes back, which starts a new visit. */
  private readonly _priceVisit = signal(0);

  /** The products this visit has read, so each is read once (velista `0145`). */
  private readonly _pricedThisVisit = new Set<string>();

  private readonly _resumed = inject(AppResumed);

  /** The catalog opened to choose a product from a row (velista `0145`, section 5). */
  private readonly _pick = inject(ProductPickStore);
  private readonly _history = inject(AppHistory);

  /**
   * Whether the products of a line on this list did not load (velista `0145`,
   * section 7). The rows keep their names, and the page says so once.
   */
  readonly productsFailed = computed(() => {
    const lines = this._lines.forList(this.listId())().lines;
    return this._itemNames.anyFailed(lines.flatMap((line) => line.itemIds));
  });

  /** The retry under that sentence: the products that failed are read again. */
  retryProducts(): void {
    const lines = this._lines.forList(this.listId())().lines;
    const itemIds = lines.flatMap((line) => line.itemIds);
    void this._itemNames.refresh(
      itemIds.filter((itemId) => this._itemNames.anyFailed([itemId]))
    );
  }

  /**
   * The plus or "Choose a product" on a row with no product (velista `0145`,
   * section 5): the catalog page that chooses one product (velista `0140`), opened
   * on the name of the line and on its supermarket. The answer is written when this
   * page is back.
   */
  chooseProduct(lineId: string): void {
    const line = this._lines
      .forList(this.listId())()
      .lines.find((candidate) => candidate.id === lineId);
    if (line === undefined) {
      return;
    }
    const locale = this._locale();
    const name = this._lineName(line);
    if (line.itemIds.length > 0) {
      // A product arrived since the row was drawn (velista `0146`, section 2):
      // the catalog that chooses the whole set, so nothing it holds is replaced.
      // It answers back onto this list, as the one it stands in for would.
      this._pick.open({
        kind: 'set',
        lineId,
        forLabel: this._translator.t('list.row.pickFor', undefined, locale, {
          name,
        }),
        forDetail: this.header()?.listName ?? '',
        chosenId: null,
        chosenIds: line.itemIds,
        returnUrl: this._router.url,
        returnDepth: this._history.depth(),
        callerState: null,
      });
      void this._router.navigateByUrl(
        productsPickPath(
          locale,
          this._basePath,
          this.zoneId(),
          this.listId(),
          lineId
        )
      );
      return;
    }
    this._pick.open({
      kind: 'one',
      lineId,
      forLabel: this._translator.t('list.row.pickFor', undefined, locale, {
        name,
      }),
      forDetail: this.header()?.listName ?? '',
      chosenId: null,
      returnUrl: this._router.url,
      returnDepth: this._history.depth(),
      callerState: { from: LIST_ROW_PICK } satisfies ListRowPick,
    });

    const url = this._router.parseUrl(
      productPickPath(
        locale,
        this._basePath,
        this.zoneId(),
        this.listId(),
        lineId
      )
    );
    const query = name.trim();
    url.queryParams = {
      ...(query === '' ? {} : { q: query }),
      ...(line.preferredSupermarketId === null
        ? {}
        : { chain: line.preferredSupermarketId }),
    };
    void this._router.navigateByUrl(url);
  }

  /** Both from the URL, and both signals: the router reuses this component. */
  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);

  private readonly _returns = inject(PageReturn);

  /**
   * What this page showed when it was left, when this arrival is a return to it: the
   * back button from the line page or the product picker. Null on a fresh visit,
   * which starts unsearched and at the top.
   */
  private readonly _back = this._returns.recall<ListPageReturn>(
    listReturnKey(this.listId())
  );

  /** The column's scroll, read as it moves and put back on a return. */
  private readonly _scroll = new ColumnScroll(this._back?.scrollTop ?? null);

  readonly reordering = signal(false);

  /** The page's own failure, as a key. Distinct from a per row failure. */
  private readonly _errorKey = signal<string | null>(null);
  private readonly _correlationId = signal<string | null>(null);

  /**
   * Whether the reader cannot read this list, or the id names nothing (velista 0156).
   * One state for both, because a reader cannot tell them apart.
   */
  private readonly _gone = signal(false);

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

  /**
   * Whether a typed add or a recording is out, which holds the composer (velista
   * `0079`, section 7).
   *
   * Two flags and not one, because the two requests overlap. With one flag a line
   * typed while the assistant was still working out a recording finished first,
   * cleared the flag, and let the next line in beside whatever the assistant was
   * about to add.
   */
  private readonly _typedBusy = signal(false);
  private readonly _voiceBusy = signal(false);

  readonly composerBusy = computed(
    () => this._typedBusy() || this._voiceBusy()
  );

  private readonly _assistant = inject<AssistantServiceI>(ASSISTANT_SERVICE);
  private readonly _catalog = inject<CatalogServiceI>(CATALOG_SERVICE);
  private readonly _profiles = inject(ShoppingProfileStore);
  private readonly _tone = inject(NOTIFICATION_TONE);

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
   *
   * `working` is the stretch between sending a recording and the answer, drawn with a
   * spinner in front of the sentence (velista `0079`, section 5).
   */
  readonly voiceStrip = signal<{
    heard: string;
    reply: string;
    messageKey: string | null;
    messageArgs?: Record<string, string | number>;
    failed: boolean;
    working?: boolean;
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

  /**
   * The name a line is drawn with, in the reader's language (velista `0144`), for
   * the product the row shows (velista `0145`, section 2).
   */
  private _lineNameOf(line: Line): LineName {
    return lineName(
      line,
      (itemId) => this._itemNames.nameOf(itemId)?.name ?? null,
      this._locale(),
      this._itemNames.pricesOf
    );
  }

  private _lineName(line: Line): string {
    return this._lineNameOf(line).text;
  }

  /** What the rows read of the catalog (velista `0145`). */
  private readonly _catalogFacts = computed<ListStateCatalog>(() => {
    const locale = this._locale();
    // Read so the sizes redraw once the translations of a cold load arrive.
    this._translator.loaded();
    const translate = (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);
    return {
      itemOf: (itemId) => this._itemNames.nameOf(itemId),
      settled: (itemId) => this._itemNames.settled(itemId),
      failed: (itemId) => this._itemNames.anyFailed([itemId]),
      pricesOf: this._itemNames.pricesOf,
      locale,
      brandSizeOf: (item) => productBrandSizeText(item, locale, translate),
      formatMoney: (amount, currency) => formatMoney(amount, currency, locale),
    };
  });

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
      // The name each row draws: a line made from a product has none of its own and
      // shows the product's (velista `0144`, section 5).
      nameOfLine: (line) => this._lineNameOf(line),
      // The product each row shows, its picture and its price (velista `0145`).
      // `ItemNames` is a signal, so a row gains its product the moment it resolves.
      catalog: this._catalogFacts(),
      // Not live means the zone room was refused. What is on screen is correct and
      // will not update itself, which is worth saying: looking live while being stale
      // is worse than looking broken.
      //
      // A plain disconnect is not this band's to say (plan 0168, D7). The page header
      // draws one mark on every page for that, and a second sentence for the same fact
      // would push the list down. A refused room is about this list only, which the
      // header mark cannot say.
      //
      // Keyed on the **zone**, not the list. Nothing subscribes per list, and it does
      // not need to: list and line events are broadcast to the zone room as well
      // (`jetstream.consumer.ts:181-187`), so the zone subscription is what makes this
      // screen live and a refused zone is what makes it stale. Asking about a list room
      // nobody joins could only ever answer no.
      live: !this._realtime.refusedZones().has(zoneId),
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

  // --- Who an empty list is shared with (velista 0152, item 4) -------------------

  private readonly _listService = inject<ListServiceI>(LIST_SERVICE);

  /**
   * Whether anybody but the reader holds a row on this list, and for which list, once
   * read.
   *
   * Read only for a list that is empty, not shared with the group, and managed by the
   * reader, because the access read needs `MANAGE`. A reader without it was given the
   * list by somebody, so the shared wording is true for them without a read.
   *
   * Not cached for the visit. The settings sheet is a child route, so this page outlives
   * it, and a grant or a flip made there changes the answer: the read runs again each
   * time a sheet closes, and the answer is dropped whenever the list stops being one
   * the read is for.
   */
  private readonly _othersHold = signal<{
    readonly listId: string;
    readonly others: boolean;
  } | null>(null);

  /** Counts the sheets that closed over this page, so the read above runs again. */
  private readonly _sheetCloses = signal(0);

  private readonly _sheetOutlet = viewChild(RouterOutlet);

  private readonly _watchSheets = effect((onCleanup) => {
    const outlet = this._sheetOutlet();
    if (outlet === undefined) {
      return;
    }
    const closes = outlet.deactivateEvents.subscribe(() =>
      this._sheetCloses.update((count) => count + 1)
    );
    onCleanup(() => closes.unsubscribe());
  });

  private readonly _privateList = computed(() => {
    const current = this.state();
    const listId = this.listId();
    const list = this._lists
      .listsIn(this.zoneId())
      .find((candidate) => candidate.id === listId);
    return current.kind === 'loaded' &&
      current.empty &&
      list?.sharedWithZone === false &&
      list.myPermissions.includes('MANAGE')
      ? listId
      : null;
  });

  private readonly _readHolders = effect((onCleanup) => {
    const listId = this._privateList();
    this._sheetCloses();
    if (listId === null) {
      this._othersHold.set(null);
      return;
    }
    // A read that a newer one replaced answers nothing.
    let current = true;
    onCleanup(() => (current = false));
    const zoneId = this.zoneId();
    void this._listService.getListAccess(listId).then(
      (entries) => {
        if (!current) {
          return;
        }
        const me = this._names
          .membersOf(zoneId)
          .find((member) => member.userId === this._session.userId())?.id;
        const others = entries.some(
          (entry) => entry.membershipId !== me && entry.permissions.length > 0
        );
        this._othersHold.set({ listId, others });
      },
      // Quiet: the last answer stays, and with none the shared wording, which is the old
      // copy and never a wrong claim that a list is private.
      () => undefined
    );
  });

  /** The empty list's body: the private wording only when nobody else has the list. */
  readonly emptyBodyKey = computed(() => {
    const listId = this._privateList();
    const held = this._othersHold();
    return listId !== null && held?.listId === listId && !held.others
      ? 'list.empty.bodyPrivate'
      : 'list.empty.body';
  });

  // --- The search, the order and one category (velista 0082) ----------------

  /**
   * The trips of this list (velista `0088`). Route provided beside `ListViewStore`, and
   * given back from this page's teardown for the same reason.
   */
  private readonly _trips = inject(TripStore);

  /** The lines the list suggests (velista `0089`). Read after the lines, never before. */
  private readonly _dueLines = inject(DueLineStore);

  /** Whether "Show more suggestions" was pressed on this visit to this list. */
  private readonly _dueExpanded = signal(false);

  /** Whether a change of a due row's amount adds the line by itself. Off for now. */
  readonly dueAddsOnStep = DUE_LINE_ADDS_ON_STEP;

  private readonly _injector = inject(Injector);

  /** The lines as the store holds them, by id, for the facts a group is decided on. */
  private readonly _lineById = computed(
    () =>
      new Map<string, Line>(
        this._lines
          .forList(this.listId())()
          .lines.map((line) => [line.id, line])
      )
  );

  /**
   * What the page draws: To buy and the trips, or one flat search (velista `0088`).
   *
   * `current.lines` is already in list order with rejected lines last. The rules are
   * `composeListGroups`; nothing here narrows anything by hand.
   */
  readonly groups = computed(() => {
    const page = this.loaded();
    if (page === null) {
      return null;
    }

    const lines = this._lineById();
    return this._view.composeGroups<LineRowVm>({
      lines: page.lines,
      factsOf: (lineId) => {
        const line = lines.get(lineId);
        return line === undefined
          ? null
          : {
              quantity: line.quantity,
              boughtCount: line.boughtCount,
              claimed: line.claimed,
              rejected: line.approvalStatus === 'REJECTED',
            };
      },
      live: this._trips.live(),
      past: this._trips.past(),
      rowsOf: (key) => this._trips.rows().get(key),
      // Only a heads read about this list that succeeded. Until then, and after one
      // failed, a line at zero with purchases stays in To buy (velista `0095`, section 5).
      tripsReady:
        this._trips.listId() === this.listId() &&
        this._trips.state() === 'loaded',
      reordering: this.reordering(),
      // Only an answer about this list: the store may still hold the list somebody
      // came from for the frame before it opens this one.
      dueLineIds:
        this._dueLines.listId() === this.listId()
          ? this._dueLines.lines().map((due) => due.lineId)
          : [],
    });
  });

  /**
   * The due rows under To buy (velista `0089`, section 2), or null when the section is
   * not drawn: during a search, in reorder mode, for a reader, and when nothing is due.
   */
  readonly dueSection = computed(() => {
    const shown = this.groups();
    const page = this.loaded();
    if (
      shown === null ||
      shown.kind !== 'groups' ||
      page === null ||
      this.reordering() ||
      !page.abilities.canDecide
    ) {
      return null;
    }

    const byId = new Map(
      this._dueLines.lines().map((due) => [due.lineId, due])
    );
    const section = selectDueLines({
      rows: shown.due,
      dueOf: (lineId) => byId.get(lineId),
      locale: this._locale(),
      expanded: this._dueExpanded(),
    });
    return section.rows.length === 0 ? null : section;
  });

  /** To buy's wanted lines, drawn above the due rows when there are any. */
  readonly wantedLines = computed<readonly LineRowVm[]>(() => {
    const shown = this.groups();
    return shown?.kind === 'groups'
      ? shown.toBuy.slice(0, shown.wantedCount)
      : [];
  });

  /** To buy's lines at zero and rejected lines, drawn below the due rows. */
  readonly restLines = computed<readonly LineRowVm[]>(() => {
    const shown = this.groups();
    return shown?.kind === 'groups' ? shown.toBuy.slice(shown.wantedCount) : [];
  });

  /** The rows of To buy, or of the search. Empty before the lines land. */
  readonly drawnLines = computed<readonly LineRowVm[]>(() => {
    const shown = this.groups();
    if (shown === null) {
      return [];
    }
    return shown.kind === 'flat' ? shown.lines : shown.toBuy;
  });

  /** The trip folds, as `lib-trip-group` draws them. None while searching or reordering. */
  readonly tripGroups = computed(() => {
    const shown = this.groups();
    if (shown === null || shown.kind === 'flat') {
      return [];
    }
    const lines = this._lineById();
    const zoneId = this.zoneId();
    return selectTripGroups({
      groups: shown.trips,
      lineOf: (lineId) => lines.get(lineId) ?? null,
      nameOf: (userId) => this._names.nameOf(zoneId, userId),
      locale: this._locale(),
      now: new Date(),
    });
  });

  /** Whether the first read of the trips failed, which is said under To buy. */
  readonly tripsFailed = computed(() => this._trips.state() === 'failed');

  readonly tripsHasMore = this._trips.hasMore;

  readonly tripsLoadingMore = this._trips.loadingMore;

  /**
   * Whether nothing at all is left to draw under the current search or view, which
   * draws the no match sentence (velista `0082`, section 5).
   */
  readonly nothingShown = computed(() => {
    const shown = this.groups();
    if (shown === null) {
      return false;
    }
    if (shown.kind === 'flat') {
      return shown.lines.length === 0;
    }
    return (
      this.activeCount() > 0 &&
      shown.toBuy.length === 0 &&
      shown.trips.length === 0
    );
  });

  /**
   * Whether To buy offers the reorder action (velista `0088`, section 7).
   *
   * The complete list, `WRITE`, and more than one line To buy would draw in reorder
   * mode. `MANAGE` too, because the action sat behind the header's menu until it moved
   * here and who may reach it did not change.
   */
  readonly canReorder = computed(() => {
    const page = this.loaded();
    if (page === null || !page.canReorder || !page.abilities.canManage) {
      return false;
    }
    return this._reorderable().length > 1;
  });

  /** The ids To buy draws in reorder mode, in list order. */
  private readonly _reorderable = computed(() => {
    const page = this.loaded();
    if (page === null) {
      return [];
    }
    const lines = this._lineById();
    return page.lines
      .filter((row) => {
        const line = lines.get(row.id);
        return (
          line !== undefined && line.quantity > 0 && !this._heldByLive(line)
        );
      })
      .map((row) => row.id);
  });

  /** A claimed line whose live trip's rows have arrived is drawn by that trip. */
  private _heldByLive(line: Line): boolean {
    if (!line.claimed) {
      return false;
    }
    const rows = this._trips.rows();
    return this._trips
      .live()
      .some((trip) =>
        (rows.get(tripKey(trip)) ?? []).some((row) => row.lineId === line.id)
      );
  }

  /** The query folded once, for the rows' `<mark>`. */
  readonly highlight = this._view.folded;

  /** How many settings are on, for the filter button's badge (section 2). */
  readonly activeCount = this._view.activeCount;

  /** Whether the reorder action is held with a sentence (section 7). */
  readonly reorderHeld = this._view.holdsReorder;

  /**
   * The heading's words: "No category" as a key, or a category's own name from its
   * data (velista `0118`), or null for no heading.
   */
  readonly heading = computed<ListCategoryHeading | null>(() => {
    const category = this.groups()?.category ?? null;
    if (category === null) {
      return null;
    }
    return category === NO_CATEGORY
      ? { kind: 'key', key: 'list.view.noCategory' }
      : { kind: 'text', text: this._view.categoryName(category) };
  });

  // --- One field finds and adds (velista 0117) -------------------------------

  private readonly _search = inject(ListSearchNavigation);
  private readonly _chrome = inject(NavChrome);
  private readonly _composer = viewChild(LineComposer);

  /**
   * Whether `?search=1` is on the URL (velista `0109`).
   *
   * Since `0117` it means that the composer's field holds words (rule F2). The first
   * character pushes it, so the phone's back button has an entry to take off, and
   * taking it off empties the field. Only the open state is in the URL, never the
   * words.
   */
  readonly searchOpen = searchOpenOf(this._route);

  /** The words in the field, trimmed, for the headings and the nothing sentence. */
  readonly typed = computed(() => this._query().trim());

  /**
   * Whether the field holds words, which is when the results replace the list: the
   * lines that match, then the catalog's cards (rule F1).
   */
  readonly typing = computed(() => this.typed() !== '');

  /** The catalog is asked from the third character, so its section starts there. */
  readonly catalogShown = computed(
    () => this.typed().length >= SUGGEST_MIN_CHARS
  );

  /**
   * The words a finished catalog search answered with nothing, while they are still
   * the words in the field, or null (velista `0108`, target 1).
   */
  readonly catalogEmptyFor = computed(() => {
    const words = this.suggestedFor();
    return words !== null &&
      !this.suggesting() &&
      this.suggestions().length === 0 &&
      words === this.typed()
      ? words
      : null;
  });

  /** The id of the results region, which the field names in `aria-controls`. */
  readonly resultsId = 'list-results';

  /** Whether the composer's field has focus. */
  private readonly _fieldFocused = signal(false);

  /** The composer's field gained or lost focus. */
  onFieldFocused(focused: boolean): void {
    this._fieldFocused.set(focused);
  }

  /**
   * The bar gives the page its room while the field has focus or holds words (rule
   * F3), so the results reach from the header to the composer.
   */
  private readonly _hideChrome = effect(() => {
    const composing = this._fieldFocused() || this.typing();
    untracked(() => this._chrome.setComposing(composing));
  });

  /** The results heading, which the page scrolls to when the results first show. */
  private readonly _resultsHeading =
    viewChild<ElementRef<HTMLElement>>('resultsHeading');

  /** Whether the results were already on screen at the last render. */
  private _resultsDrawn = false;

  /**
   * When the results first appear, the column scrolls so their heading sits under
   * the header. The list's progress block goes above the fold while typing and comes
   * back with the list.
   *
   * Not on a return to the page: the results were already on screen when somebody
   * left, and the place they were reading in is what {@link _scroll} puts back.
   */
  private readonly _scrollToResults = afterRenderEffect(() => {
    const heading = this._resultsHeading()?.nativeElement;
    const column = this._column()?.nativeElement;
    if (heading === undefined || column === undefined) {
      if (!this._scroll.returning) {
        this._resultsDrawn = false;
      }
      return;
    }
    if (this._resultsDrawn || this._scroll.returning) {
      this._resultsDrawn = true;
      return;
    }
    this._resultsDrawn = true;
    const top =
      column.scrollTop +
      heading.getBoundingClientRect().top -
      column.getBoundingClientRect().top;
    column.scrollTo?.({ top, behavior: 'auto' });
  });

  /** Whether an open of the search entry was asked for and has not landed yet. */
  private _opening = false;

  /** Whether a close of the search entry was asked for and has not landed yet. */
  private _closing = false;

  /** Whether the entry was on the URL the last time the effect below ran. */
  private _wasOpen = false;

  /**
   * Keeps the history entry and the field saying the same thing (rule F2).
   *
   * - The first character pushes `search=1`.
   * - An empty field with `search=1` on the URL goes back through
   *   `ListSearchNavigation.close`, which is `PageNavigation.back` with the page as
   *   the fallback. The field is emptied by hand, by Escape and by an add, and a cold
   *   load of `?search=1` arrives empty: all of them take the entry off the same way.
   * - The entry going while the field still holds words is the phone's back button,
   *   so the field is emptied to match.
   *
   * A close still in flight is not mistaken for back: words typed while it lands
   * push a new entry rather than being emptied.
   */
  private readonly _followEntry = effect(() => {
    const open = this.searchOpen();
    const words = this.typing();
    untracked(() => {
      const was = this._wasOpen;
      this._wasOpen = open;

      if (open) {
        this._opening = false;
        if (!words && !this._closing) {
          this._closing = true;
          void this._search.close(this._route);
        }
        return;
      }

      const closing = this._closing;
      this._closing = false;
      if (!words) {
        return;
      }
      if (was && !closing) {
        this._composer()?.clear();
        return;
      }
      if (!this._opening) {
        this._opening = true;
        void this._search.open(this._route);
      }
    });
  });

  /**
   * A card's add button, in the results. It adds exactly as it did from the panel:
   * through the composer, which names the words and the products and then empties
   * the field and keeps focus in it.
   */
  chooseCard(choice: SuggestionChoice): void {
    this._composer()?.choose(choice.suggestion, choice.anchor);
  }

  /**
   * Nothing in the results may take focus from the field, so the keyboard stays up
   * whatever was pressed (rule T2 of velista `0101`). `mousedown` and never
   * `pointerdown` or `touchstart`, which carry the page's own scroll.
   */
  holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  openFilter(): void {
    void this._openSheet(['filter']);
  }

  /** The empty view's Reset: the order and the category back to their defaults. */
  resetView(): void {
    this._view.reset();
  }

  // Velista `0159`: the quantity changes an earlier document of this tab lost to the
  // network. The reconnect reloads the page and the row's own note goes with it, so
  // the store wrote each one down, and this page reads its own once and clears them.
  // Taken again when the list in the URL changes, so another list's entries wait.
  private readonly _droppedLedger = inject(DroppedWrites);
  private readonly _dropped = signal<readonly DroppedWrite[]>([]);
  private readonly _takeDropped = effect(() => {
    const page = listWritesPage(this.listId());
    untracked(() => this._dropped.set(this._droppedLedger.take(page)));
  });

  /** One sentence per lost change, named as the row names the line. */
  readonly droppedNotices = computed(() => {
    const locale = this._locale();
    // Read so the sentence redraws once the translations of a cold load arrive.
    this._translator.loaded();
    const lines = this._lineById();
    return this._dropped().map((entry) => {
      const replay = entry.replay;
      // Off the entry, not the replay, so an unsure entry is named as the row names
      // the line too.
      const line = lines.get(entry.lineId);
      const name =
        line === undefined ? entry.args['name'] : this._lineName(line);
      return {
        id: entry.id,
        text: this._translator.t(
          `${entry.key}.${replay === null ? 'unsure' : 'lost'}`,
          undefined,
          locale,
          { ...entry.args, name }
        ),
        canResend: replay !== null,
      };
    });
  });

  dismissDropped(id: string): void {
    this._dropped.update((entries) =>
      entries.filter((entry) => entry.id !== id)
    );
  }

  /** "Send it again": the same delta, through the same path as a turn of the reel. */
  async resendDropped(id: string): Promise<void> {
    const replay = this._dropped().find((entry) => entry.id === id)?.replay;
    this.dismissDropped(id);
    if (replay !== null && replay !== undefined) {
      await this.changeQuantity({ lineId: replay.lineId, delta: replay.delta });
    }
  }

  constructor() {
    // A return to this page comes back to what it showed (`PageReturn`). Applied
    // here, before any effect runs, so the search entry's effect finds the words it
    // expects on `?search=1` rather than taking the entry off for an empty field.
    const back = this._back;
    const words =
      back !== null && this.searchOpen() && back.words.trim() !== ''
        ? back.words
        : null;
    if (back !== null) {
      this._view.open(this.listId());
      this._view.resume(back.view);
      this._dueExpanded.set(back.dueExpanded);
    }
    if (words !== null) {
      this.onComposerQuery(words);
      // The field is drawn once the list has loaded, so the words wait for it.
      const filled = effect(() => {
        const composer = this._composer();
        if (composer !== undefined) {
          composer.fill(words);
          filled.destroy();
        }
      });
    }

    // The scroll it was left at, once the rows are there to scroll over.
    afterRenderEffect(() => {
      this._scroll.attach(this._column()?.nativeElement ?? null);
      this._scroll.settle(this.loaded() !== null);
    });

    // The view store follows the list in the URL. Opening another list restores the
    // remembered order and starts with no search and all lines.
    effect(() => {
      const listId = this.listId();
      untracked(() => this._view.open(listId));
    });

    // The trips, beside the lines and never in front of them (velista 0088, section 8).
    effect(() => {
      const listId = this.listId();
      untracked(() => this._trips.open(listId));
    });

    // Another list starts folded to three suggestions again (velista 0089, section 2).
    // The list this page was returned to keeps the fold it had.
    let foldedFor = back === null ? null : this.listId();
    effect(() => {
      const listId = this.listId();
      untracked(() => {
        if (listId !== foldedFor) {
          foldedFor = listId;
          this._dueExpanded.set(false);
        }
      });
    });

    // The due lines, once the lines have arrived and never in front of them (velista
    // 0089, section 3). `open` asks nothing for a list it already holds, so this can
    // run on every change of the page's state.
    effect(() => {
      const listId = this.listId();
      if (this.state().kind === 'loaded') {
        untracked(() => this._dueLines.open(listId));
      }
    });

    // The newest live trip is open when the trips first arrive, once per visit.
    effect(() => {
      if (this._trips.state() !== 'loaded') {
        return;
      }
      const newest = this._trips.live()[0];
      untracked(() =>
        this._view.seedOpenTrip(newest === undefined ? null : tripKey(newest))
      );
    });

    // Rows load on first open and stay loaded for the visit. The store asks only for a
    // trip it has not asked for, so this can run on every change to the heads. A picked
    // category asks for every trip's rows, because only the rows can say whether a
    // trip holds a line in it, and a trip that cannot say is not drawn (`0088`, 6).
    effect(() => {
      const open = this._view.openTrips();
      const filtered = this._view.picked() !== null;
      const trips = [...this._trips.live(), ...this._trips.past()];
      untracked(() => {
        for (const trip of trips) {
          if (filtered || open.has(tripKey(trip))) {
            this._trips.ensureRows(trip);
          }
        }
      });
    });

    // The products on every line with their prices, for the rows, the category view
    // and the search (velista `0082`, section 3, and `0145`, section 7). Each product
    // is read once for each visit: when the page opens, and again after the app or
    // the socket comes back. A line that arrives over the socket, or changes its
    // products, asks for the ones this visit has not read. `ItemNames` splits a large
    // set at the lookup limit.
    let visit: string | null = null;
    effect(() => {
      const listId = this.listId();
      const lines = this._lines.forList(listId)().lines;
      const current = `${listId}:${this._priceVisit()}`;
      if (current !== visit) {
        visit = current;
        this._pricedThisVisit.clear();
      }
      const fresh = [...new Set(lines.flatMap((line) => line.itemIds))].filter(
        (itemId) => !this._pricedThisVisit.has(itemId)
      );
      if (fresh.length > 0) {
        for (const itemId of fresh) {
          this._pricedThisVisit.add(itemId);
        }
        untracked(() => void this._itemNames.refresh(fresh));
      }
    });

    // The app or the socket came back: a new visit for the prices. The edges only,
    // so neither first run counts. The socket's first connect is not a return
    // either: on a cold open it starts down, and the page has just read. A
    // reconnect that follows a resume closely is the same return, which the resume
    // has read for already.
    let seenResumes = untracked(() => this._resumed.resumes());
    let wasConnected = untracked(() => this._realtime.connected());
    let hasConnected = wasConnected;
    let resumedAt: number | null = null;
    effect(() => {
      const resumes = this._resumed.resumes();
      const connected = this._realtime.connected();
      untracked(() => {
        const resumed = resumes !== seenResumes;
        const reconnected = connected && !wasConnected && hasConnected;
        seenResumes = resumes;
        wasConnected = connected;
        hasConnected ||= connected;
        const now = Date.now();
        if (resumed) {
          resumedAt = now;
        }
        const afterResume =
          !resumed &&
          resumedAt !== null &&
          now - resumedAt < RECONNECT_AFTER_RESUME_MS;
        if (resumed || (reconnected && !afterResume)) {
          this._priceVisit.update((visit) => visit + 1);
        }
      });
    });

    // The answer of the catalog opened to choose a product from a row (velista
    // `0145`, section 5): that product becomes the line's one product.
    // The page is a route of its own, so this page was gone while it was open: the
    // answer is found by what the request said it was for, not by this instance.
    effect(() => {
      const answer = this._pick.answer();
      const lines = this._lines.forList(this.listId())().lines;
      if (
        answer === null ||
        (answer.callerState as ListRowPick | null)?.from !== LIST_ROW_PICK ||
        !lines.some((line) => line.id === answer.lineId)
      ) {
        return;
      }
      untracked(() => {
        const taken = this._pick.takeAnswer(answer.lineId);
        if (taken?.itemId != null) {
          void this._lines.updateLine(taken.lineId, {
            itemIds: [taken.itemId],
          });
        }
      });
    });

    // The lines, from the list id alone. Keyed on the id and nothing else, so it runs
    // again when the person navigates from one list to another and never because its
    // own answer landed.
    effect(() => {
      const listId = this.listId();
      untracked(() => {
        this._errorKey.set(null);
        this._gone.set(false);
        // Another list under the same unreadable group: the zone effect does not run
        // again, so the group's answer is read here (velista 0156).
        this._afterZoneRead(this.zoneId());
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
        void this._zones
          .loadZone(zoneId)
          .then(() => this._afterZoneRead(zoneId));
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
        if (!checked || lists.state !== 'loaded' || this._gone()) {
          return;
        }

        if (!lists.lists.some((list) => list.id === listId)) {
          // Deleted and unshared are indistinguishable from here, so the page says
          // the one sentence that covers both and claims neither (velista 0156).
          this._gone.set(true);
        }
      });
    });

    // A sheet URL over a list this reader cannot read (velista 0156). The outlet is
    // not drawn in that state, so the address would name a sheet nobody sees: it is
    // replaced with the page's own, which is what is on screen. Replaced and not
    // pushed, so back does not reopen the sheet URL.
    effect(() => {
      if (this.state().kind !== 'gone') {
        return;
      }
      untracked(() => {
        if (this._route.firstChild) {
          void this._router.navigate(['.'], {
            relativeTo: this._route,
            replaceUrl: true,
          });
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
      // The bar comes back with whatever screen is next (velista `0117`).
      this._chrome.setComposing(false);
      // What a return to this list comes back to, taken before the stores let go.
      this._returns.keep<ListPageReturn>(listReturnKey(this.listId()), {
        view: this._view.snapshot(),
        words: this._query(),
        dueExpanded: this._dueExpanded(),
        scrollTop: this._scroll.top,
      });
      this._scroll.detach();
      // The view store is provided on the route and is never destroyed, so it is
      // given back here, as the basket page gives back `BasketViewStore`.
      this._view.leave();
      this._trips.leave();
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
   * The column is the one scroll container on this screen in both run modes, because
   * the app is a frame that never scrolls (velista 0106), so it is the column that is
   * asked to move.
   *
   * Scrolling to the very end rather than bringing the row into view: the composer is
   * the next item after the column, so at the end of the scroll the newest line is
   * directly above the field.
   */
  private _scrollToNewest(column: HTMLElement): void {
    column.scrollTo?.({
      top: column.scrollHeight,
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

    // Only this page's writes are written down if the network drops them, because
    // only this page draws the notice (velista `0159`).
    const outcome = await this._lines.addQuantity(event.lineId, event.delta, {
      reportDropped: true,
    });
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
          this._translator.t(
            'list.line.quantityChanged',
            undefined,
            undefined,
            {
              name: this._lineName(line),
              quantity: line.quantity,
            }
          )
        );
      }
    }
  }

  /**
   * Everything the row's decision buttons and grip emit.
   *
   * Edit, comments and delete are not here since velista plan 0083: the row has no menu,
   * and the detail sheet a tap opens is where each of them starts.
   */
  async act(event: { action: LineRowAction; lineId: string }): Promise<void> {
    switch (event.action) {
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
    named?: false;
  }): Promise<void> {
    const current = this.loaded();
    this._typedBusy.set(true);

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
      entry.itemIds,
      // A chosen card is not named (velista `0144`, section 3).
      entry.named
    );

    // The list the suggestions were for has been added. Clearing here rather than in
    // the composer keeps the two from disagreeing about whether a dropdown is open.
    this._query.set('');
    this._typedBusy.set(false);

    if (outcome.state === 'failed') {
      this._reportPageError(outcome.error, 'lines.write');
      return;
    }

    // The name the new row draws, which for a card is the product's.
    this.announcement.set(this._lineName(outcome.line));
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

    this._voiceBusy.set(true);
    // Said at once, and replaced by the reply or the failure exactly as nothing used
    // to be (velista `0079`, section 5). A turn takes seconds, and a strip that is
    // empty for all of them reads as a recording that went nowhere.
    this.voiceStrip.set({
      heard: '',
      reply: '',
      messageKey: 'list.add.working',
      failed: false,
      working: true,
    });

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
      // dialog (plan 0038, section 6). Which sentence is `voiceFailureCopy`, which is
      // where the reasoning lives; the short version is that the strip is the only
      // thing telling somebody whether the list changed, so it says "nothing was
      // added" only where that is a fact.
      this.voiceStrip.set({
        heard: '',
        reply: '',
        ...voiceFailureCopy(error),
        failed: true,
      });
    } finally {
      this._voiceBusy.set(false);
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

  /**
   * The catalog is being asked, from the moment the debounce fires until the answer
   * that is still wanted lands. The composer draws skeleton cards for it while it has
   * no cards to show (velista `0101`).
   */
  readonly suggesting = signal(false);

  /**
   * The words {@link suggestions} answer, or null when nothing has been asked, so the
   * composer can say that a finished search for what is in its field found nothing
   * (velista `0108`, target 1) and a group card can name the synonym it matched.
   */
  readonly suggestedFor = signal<string | null>(null);

  /**
   * The lines on this list already holding what a card offers (velista `0101`,
   * section 4), a join over lines this page already holds rather than a field to
   * ask for.
   *
   * A product is held by a line whose products name it. A group is held by a line
   * that follows it, because choosing a group again would make a second line for
   * the same kind of thing. The stepper moves only for somebody who may decide
   * quantities here, the rule the rows' own reel follows.
   */
  readonly holdingsOf = computed(() => {
    const lines = this._lines.linesIn(this.listId());
    const editable = this.loaded()?.abilities.canDecide ?? false;
    return (suggestion: CatalogSuggestion): readonly SuggestionHolding[] =>
      lines
        .filter((line) =>
          suggestion.kind === 'group'
            ? line.productGroupId === suggestion.group.id
            : line.itemIds.includes(suggestion.item.id)
        )
        .map((line) => ({
          key: line.id,
          lineId: line.id,
          text: line.content,
          listName: null,
          quantity: line.quantity,
          editable,
        }));
  });

  /**
   * Where a card's "Details" opens a product: the product's own page (velista
   * `0134`, section 8). Its back control pops, so it lands back on this list.
   */
  readonly productLink = computed(() => {
    const locale = this._locale();
    return (itemId: string): string =>
      productPagePath(locale, this._basePath, itemId);
  });

  /**
   * A card's stepper moved a line that already holds the product. The same write as
   * the row's own reel, so the same guard, the same failure copy and the same
   * sentence afterwards.
   */
  async changeHolding(change: SuggestionHoldingChange): Promise<void> {
    await this.changeQuantity({
      lineId: change.holding.lineId,
      delta: change.to - change.from,
    });
  }

  /**
   * The last thing typed, which the catalog's effect, the list's search and the
   * results all watch (velista `0117`).
   */
  private readonly _query = signal('');

  onComposerQuery(query: string): void {
    this._query.set(query);
    // The lines are searched from the first character, the catalog from the third.
    this._view.search(query);

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
    const query = this._query().trim();

    if (query.length < SUGGEST_MIN_CHARS) {
      // Cleared synchronously rather than after the debounce: a dropdown that lingered
      // over a field somebody has just emptied is offering matches for nothing.
      untracked(() => {
        this.suggestions.set([]);
        this.suggesting.set(false);
        this.suggestedFor.set(null);
      });
      return;
    }

    const timer = setTimeout(() => {
      const seq = (this._suggestSeq += 1);
      this.suggesting.set(true);
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
            this.suggestions.set(productSuggestions(found));
            this.suggestedFor.set(query);
            this.suggesting.set(false);
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
    // The header holds the action and says why, so this is belt on top of braces:
    // a drag over a searched, sorted or narrowed screen would rewrite positions
    // nobody can see (velista 0082, section 7).
    if (this.reorderHeld()) {
      return;
    }
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

  /** "Show more suggestions": every due line, and focus to the first one it drew. */
  showMoreDue(): void {
    const before = this.dueSection()?.rows.length ?? 0;
    this._dueExpanded.set(true);

    const next = this.dueSection()?.rows[before];
    if (next !== undefined) {
      this._focusAfterRender(`[data-due-line-id="${next.lineId}"] .add`);
    }
  }

  /**
   * A due line taken (velista `0089`, sections 2 and 6).
   *
   * The reel's own write, from zero to the chosen amount, so the line is raised exactly
   * as a drag would raise it. The write is optimistic, so the line is above zero before
   * this awaits anything and the row leaves the section at once. A failed write puts the
   * quantity back, which brings the row back, and says why through the polite region:
   * the line's own row, where a reel write reports, is not drawn while it is at zero.
   *
   * Focus moves to the next due row's button, or to the line just added when none is
   * left, and the polite region says the line was added.
   */
  async addDueLine(event: { lineId: string; quantity: number }): Promise<void> {
    const page = this.loaded();
    const line = this._lineById().get(event.lineId);
    if (page === null || !page.abilities.canDecide || line === undefined) {
      return;
    }
    const delta = event.quantity - line.quantity;
    if (delta <= 0) {
      return;
    }

    const rows = this.dueSection()?.rows ?? [];
    const at = rows.findIndex((row) => row.lineId === event.lineId);
    const pending = this._lines.addQuantity(event.lineId, delta, {
      reportDropped: true,
    });

    const next = this.dueSection()?.rows[Math.max(0, at)];
    this._focusAfterRender(
      next === undefined
        ? `[data-line-id="${event.lineId}"] .row`
        : `[data-due-line-id="${next.lineId}"] .add`
    );

    const outcome = await pending;
    if (outcome === 'failed') {
      this._reportPageError(this._lines.errorOf(this.listId()), 'lines.write');
      return;
    }

    this.announcement.set(
      this._translator.t('list.due.added', undefined, undefined, {
        name: this._lineName(line),
      })
    );
  }

  /** Focus the first element matching `selector` in the column, once it is drawn. */
  private _focusAfterRender(selector: string): void {
    afterNextRender(
      () => {
        this._column()
          ?.nativeElement.querySelector<HTMLElement>(selector)
          ?.focus();
      },
      { injector: this._injector }
    );
  }

  /** A trip's head was pressed. What is open is remembered for the visit. */
  toggleTrip(key: string): void {
    this._view.toggleTrip(key);
  }

  /**
   * "Show older trips" (velista 0088, section 10). Focus stays on the button, and how
   * many trips arrived is said through the page's polite region.
   */
  async loadOlderTrips(): Promise<void> {
    const outcome = await this._trips.loadMore();
    this.announcement.set(
      outcome.state === 'failed'
        ? this._translator.t('list.trips.olderFailed')
        : this._translator.t('list.trips.arrived', undefined, undefined, {
            count: outcome.added,
          })
    );
  }

  /** The failed first read of the trips, asked again. The lines were never blocked. */
  retryTrips(): void {
    this._trips.retry();
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

  /**
   * A group this reader cannot read, or one that does not exist, makes the list under
   * it unreadable too (velista 0156). Without this a real list under a mistyped group
   * id drew its lines read only, because the lines answered and the group did not.
   *
   * Only an uncached group counts: a refetch that fails over a cached one leaves its
   * state loaded, which is `ZoneStore`'s rule for a background reconcile.
   */
  private _afterZoneRead(zoneId: string): void {
    if (
      zoneId !== this.zoneId() ||
      this._zones.zoneState().get(zoneId) !== 'failed'
    ) {
      return;
    }
    if (listErrorEffect(this._zones.error(), 'lines.read') === 'gone') {
      this._gone.set(true);
    }
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

    // To buy is what moves (velista 0088, section 7). The lines it shows take the slots
    // they held among all the list's lines, and every other line keeps its own, so the
    // whole order is still sent and nothing hidden from the person moves.
    const all = current.lines.map((line) => line.id);
    const ids = this._reorderable();
    const from = ids.indexOf(lineId);
    if (from < 0) {
      return;
    }

    const to = destination(from);
    const next = reorderWithinSlots(all, ids, lineId, to);
    if (next === null) {
      return;
    }

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
        this._gone.set(true);
        return true;
      case 'reread':
        void this._lines.refresh(this.listId());
        return true;
      default:
        return false;
    }
  }

  /**
   * Open one of this page's sheets, named by what it is about.
   *
   * The `sheet` marker is added here rather than by the five callers, which is the
   * same argument the route table makes for adding it in `sheet()`: a rule that has to
   * be remembered five times is a rule that will be missed once.
   */
  private _openSheet(path: readonly string[]): Promise<boolean> {
    return this._router.navigate(sheetSegments(...path), {
      relativeTo: this._route,
      // An open search stays open under the sheet, so closing the sheet comes back
      // to it (velista `0109`).
      queryParams: this._search.kept(this._route),
    });
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

/**
 * The words above a list shown one category at a time: this app's own for "No
 * category", and the catalog's name for every other (velista `0118`). A union rather
 * than a string, for the reason the basket's section heading gives: nothing may have
 * to guess whether a category somebody named is a translation key.
 */
type ListCategoryHeading =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'text'; readonly text: string };
