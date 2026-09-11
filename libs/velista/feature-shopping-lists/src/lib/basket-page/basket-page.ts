import {
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
  BASKET_REOPEN_AVAILABLE,
  BasketStore,
  BasketViewStore,
  GeneratedListStore,
  SessionStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  outstanding,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  type BasketLine,
  type BasketLineOrigin,
  type BasketViewRow,
  type BasketViewSection,
  type CatalogSuggestion,
} from '@portfolio/velista/models';
import {
  appPath,
  PageNavigation,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  ChevronLeftIcon,
  ChipRow,
  CloseIcon,
  FilterIcon,
  FlagIcon,
  LineComposer,
  OfflineIcon,
  PersonIcon,
  SearchIcon,
  ShareIcon,
  type ChipRowItem,
} from '@portfolio/velista/ui';
import { basketErrorKey } from '../basket-error-copy';
import { outstandingCaption, participantInitials } from '../basket-labels';
import { BasketLineRow } from '../basket-line-row/basket-line-row';
import { BASKET_PATHS } from '../basket-paths';

/**
 * The basket: a list of lines with quantities, which whoever is holding the
 * phone works through (plan 0044, section 4).
 *
 * ## Three readers, one screen, differing by absence
 *
 * The owner, a registered participant who passes the all or nothing rule, and a
 * guest all get this component. What differs is what is **not drawn**:
 *
 * | | owner | passes the rule | guest |
 * | --- | --- | --- | --- |
 * | lines, quantities, outstanding | yes | yes | yes |
 * | settle, partial submit, swap the product | yes | yes | yes |
 * | the composer, and the catalog behind it | yes | yes | yes |
 * | which list a line came from | yes | yes | no |
 * | the allocation sheet | yes | yes | no |
 * | another participant's device and join time | yes | yes | no |
 * | the share control | yes | no | no |
 *
 * `0030` settled this for the list page and it holds here: **a control you may
 * not use is not drawn**, never disabled. Most of it needs no branch at all,
 * because the server omits the data: a guest's line has no `origins` key, so the
 * row's "from" caption has nothing to render and the rule enforces itself.
 *
 * The two things that do branch are the share control, which is the owner's
 * alone, and the allocation pane, which the settle sheet draws on
 * `seesZoneData`. Both are also refused server side, so a template mistake is a
 * cosmetic bug rather than a disclosure.
 *
 * **The composer is the one row of that table with no reader-shaped condition on
 * it at all** (plan 0053, section 2), and that is worth stating rather than
 * inferring from a missing `@if`. The list page draws its field from certainty,
 * because `myPermissions` arrives with the list; here a line added has no target
 * list, so it changes nothing shared and there is no permission to read. What it
 * does branch on is the basket: a finished one takes no lines, so it draws no
 * field.
 *
 * ## No back arrow for a guest
 *
 * There is nowhere back to go: they arrived on a link and this is the whole app
 * to them. The owner gets one, to the history.
 *
 * ## Coming back to it
 *
 * The screen refetches when the app is resumed (`0035`), which is the moment a
 * shopper's phone is most likely to be behind somebody else's. Since `0048` it is
 * also live: `BasketSocket` holds a participant authenticated connection to this
 * one basket, which is the connection a guest can open because it does not need an
 * account. When it will not open the screen still works and **says so**, because a
 * basket that is quietly not updating is indistinguishable from a shop where
 * nobody is doing anything.
 */
@Component({
  selector: 'lib-basket-page',
  imports: [
    BasketLineRow,
    ChevronLeftIcon,
    ChipRow,
    CloseIcon,
    FilterIcon,
    FlagIcon,
    LineComposer,
    OfflineIcon,
    PersonIcon,
    RokuTranslatorPipe,
    RouterOutlet,
    SearchIcon,
    ShareIcon,
  ],
  templateUrl: './basket-page.html',
  styleUrl: './basket-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketPage {
  private readonly _store = inject(BasketStore);
  /**
   * What this screen is showing of the basket, as opposed to what is in it.
   *
   * Route provided beside {@link BasketStore}, so the sheets `0075` and `0078` add
   * reach the same instance the page reads. See the class comment there.
   */
  private readonly _view = inject(BasketViewStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  /**
   * The account, for the one name the basket does not carry: the owner's own.
   *
   * Null for a guest, who has no account and whose own row the server does name.
   */
  private readonly _session = inject(SessionStore);
  /**
   * The owner's own surface, for the one write this screen makes that is not a
   * participant's: finishing the trip, and taking it back (velista `0057`).
   *
   * Injected for every reader, guests included, and that costs nothing: the store is
   * app scoped and already constructed by the dashboard, and nothing here calls it
   * unless the control that reaches it was drawn, which is the owner's alone.
   */
  private readonly _generated = inject(GeneratedListStore);

  private readonly _id =
    this._route.snapshot.paramMap.get('generatedListId') ?? '';

  protected readonly state = this._store.state;
  protected readonly lines = this._store.lines;
  protected readonly progress = this._store.progress;
  protected readonly busyLines = this._store.busyLines;
  protected readonly participantsById = this._store.participantsById;
  protected readonly listNames = this._store.listNames;
  protected readonly seesZoneData = this._store.seesZoneData;

  /** Only the owner is offered the share control, and only they can use it. */
  protected readonly isOwner = computed(
    () => this._store.me()?.kind === 'OWNER'
  );

  /**
   * Whether the trip is over, which is what takes every control off this screen
   * (plan 0057, section 6).
   *
   * The screen still reads. It is the receipt for a trip somebody took, and the most
   * likely reason to open one is to see what was bought, so every line, every
   * settlement, the people, the history, the share sheet and the link are all still
   * here. What goes is everything that would change it, absent rather than disabled
   * per `0030`: the settle control on a row, the reel, the composer, the product
   * swap, the units sheet and the send sheet.
   */
  protected readonly finished = this._store.finished;

  /**
   * Whether to draw the control that ends the trip, and it is the **owner's alone**.
   *
   * Absent for a registered participant and absent for a guest, not disabled, which
   * is `0030`'s rule and the treatment the share control beside it already gets.
   * Finishing ends the trip for four people at once, which is why it is not handed to
   * whoever happens to be holding a link; somebody who is not the owner and thinks
   * the shopping is over can say so in the basket's own chat.
   *
   * The server agrees rather than being trusted to: the route behind it is account
   * authenticated and scoped to the owner, so a guest cannot reach it with any token
   * they hold. {@link isOwner} already existed for the share control and this is its
   * second reader.
   */
  protected readonly canFinish = computed(
    () => this.isOwner() && !this.finished()
  );

  /**
   * Whether to ask "all done?", which is **all** the last settle does (section 4).
   *
   * Settling the last line is not a status change and finishes nothing. The server
   * does not do it (luna `0059`, section 1.1) and this screen does not pretend it
   * did: it asks, and a prompt is one tap for the person who is done and nothing at
   * all for the person who is not. The most common thing that happens after the last
   * line is settled is remembering milk, and a screen that had closed itself would
   * have to be reopened by somebody standing in a dairy aisle.
   *
   * Only where there were lines to settle, so a basket that arrived empty does not
   * congratulate anybody, and only for the reader who could act on it.
   */
  protected readonly allSettled = computed(
    () =>
      this.canFinish() &&
      this.lines().length > 0 &&
      this._store.unsettled() === 0
  );

  /** Whether a finish or a reopen is in flight, so the banner's control can wait. */
  private readonly _statusBusy = signal(false);

  protected readonly statusBusy = this._statusBusy.asReadonly();

  /**
   * Whether the last reopen did not land, said on the banner it was pressed from.
   *
   * On the banner rather than as a toast, which is `0012` section 3.3's rule: the
   * control is still there, the sentence belongs beside it, and the basket is still
   * the finished one it was.
   */
  private readonly _reopenFailed = signal(false);

  protected readonly reopenFailed = this._reopenFailed.asReadonly();

  /** The reader's own participant id, so their own edits can be named. */
  protected readonly meId = computed(() => this._store.me()?.id ?? null);

  /**
   * The reader's own account name, handed down to every row.
   *
   * Read once here rather than in {@link BasketLineRow}, which is constructed once per
   * line: the page already holds the session, and the caption on a line the reader
   * settled themselves is the one thing on the row the basket alone cannot name.
   */
  protected readonly ownName = computed(() => this._session.username());

  protected readonly products = this._store.products;

  /**
   * What to call this basket.
   *
   * Null on the wire is not missing: an unnamed basket is displayed as its
   * generation date, and core does not know the reader's locale so it never
   * stores one. `0045` owns the same-day disambiguation for the history listing;
   * a single basket on its own screen needs no number, so this is the plain date.
   */
  protected readonly title = computed(() => {
    const basket = this._store.basket();
    if (basket === null) {
      return this._translator.t('basket.title', undefined, this._locale());
    }
    if (basket.name !== null && basket.name !== '') {
      return basket.name;
    }
    const at = basket.generatedAt;
    if (at === null) {
      return this._translator.t('basket.unnamed', undefined, this._locale());
    }
    try {
      // `Intl` rather than `DatePipe`, which is this library's convention: the
      // pipe needs `registerLocaleData` per locale and a `LOCALE_ID` this app
      // does not set, because the language is runtime state rather than the
      // shell's build time locale.
      return new Intl.DateTimeFormat(this._locale(), {
        dateStyle: 'medium',
      }).format(at);
    } catch {
      // An unrecognised tag, which `Intl` throws a `RangeError` for. A basket
      // titled by its ISO date is ugly; one with no title at all is worse.
      return at.toISOString().slice(0, 10);
    }
  });

  /**
   * Whether the basket is live, so the screen can say when it is not (`0048`).
   *
   * A live basket and a refetching one look identical while nobody else is
   * shopping, and completely different the moment somebody is.
   */
  protected readonly live = this._store.live;

  /** Whether this participant has been removed while the phone was in their hand. */
  protected readonly revoked = this._store.revoked;

  /**
   * Whether a finished row's status control may be pressed (plan 0052, section 10).
   *
   * A build constant and not state, so it is read once here and handed down rather
   * than imported by the row, which is constructed once per line. While it is false a
   * finished line's glyph is a state indicator instead of a button: it says what the
   * line is, and does not offer an act that would 404 against a backend without luna
   * `0054`'s route.
   */
  protected readonly canReopen = BASKET_REOPEN_AVAILABLE;

  /**
   * What the last move of a row's number came to, for the live region.
   *
   * **One region for the whole basket**, which is the same choice the composer's
   * announcement makes and for the same reason: a polite region reads whatever the
   * node last held, so four people working one list collapse into one sentence
   * instead of talking over each other for the length of a trip.
   */
  protected readonly outstandingSaid = signal('');

  /**
   * The one refusal a row is still showing, and which row it belongs to.
   *
   * One at a time across the whole screen. A sentence about a race is worth reading
   * for as long as the number it corrects is on screen and no longer: it is cleared
   * the moment any row starts another move.
   */
  private readonly _notice = signal<{
    readonly lineId: string;
    readonly key: string;
    readonly count: number;
  } | null>(null);

  /** The notice for this row, or null. Identity is stable, so the row is not redrawn. */
  protected noticeFor(
    line: BasketLine
  ): { readonly key: string; readonly count: number } | null {
    const notice = this._notice();
    return notice !== null && notice.lineId === line.id ? notice : null;
  }

  /**
   * Which lines were sent to a list that has not accepted them yet (`0056`).
   *
   * From the store rather than from the lines, because no field of a line carries
   * it. See `BasketStore.pendingTargets` for the gap it stands in for.
   */
  protected readonly pendingTargets = this._store.pendingTargets;

  /**
   * The faces along the top: **who has this basket open right now**.
   *
   * `0048` section 4 is the change. This used to be built from the participant
   * list, which answers a different question — who has ever joined — and the two
   * diverge exactly when it matters, which is after a trip, when everybody has
   * gone home and the basket still claims a crowd. The mock says "4 here now";
   * the participant list said something closer to "4 have a link".
   *
   * **No sentence.** "Three anonymous users are shopping with you" was considered
   * and dropped for being a paragraph where a row does the job, and the word
   * anonymous appears nowhere in this product: they are guests (section 5.1).
   *
   * The initials come from {@link participantInitials} rather than from two sliced
   * characters of the label, which is what drew the same bubble for everybody: an
   * unnamed owner and every unnamed guest all resolved to a word beginning "Gu".
   * The reader's own account name is handed in because core keeps none for an
   * owner, so their own face is the one the basket alone cannot name.
   */
  protected readonly faces = computed(() => {
    const meId = this.meId();
    const ownName = this._session.username();

    return this._store
      .present()
      .slice(0, 3)
      .map((person) => ({
        id: person.participantId,
        initials: participantInitials(
          person,
          this._translator,
          this._locale(),
          { ownName: person.participantId === meId ? ownName : null }
        ),
        isGuest: person.kind === 'GUEST',
      }));
  });

  /**
   * Whether there is anybody to read about in the people sheet.
   *
   * Not the same question as {@link faces}. Presence empties when the socket drops
   * and when everybody has gone home, and in both cases the sheet still answers
   * something worth knowing — everybody who *can* open this basket — so the way into
   * it has to survive the face row going away.
   */
  protected readonly hasPeople = computed(
    () => this._store.participants().length > 0
  );

  /** The overflow count, collapsing into a stacked chip like the price display. */
  protected readonly overflow = computed(() =>
    Math.max(0, this._store.present().length - 3)
  );

  constructor() {
    /**
     * The basket, and then what this device remembers about how to draw it
     * (`0076`, section 3).
     *
     * After the load and not beside it, because the two things the remembered
     * record is checked against — the basket's price scopes and the lists it drew
     * from — arrive with the basket. Once, here, rather than watched: a value whose
     * date passes while the shopper is standing in an aisle must not move the rows
     * in front of them.
     */
    void this._store.open(this._id).then(() => this._view.restore());

    /**
     * The socket is closed from **here**, and it has to be.
     *
     * `BasketStore` and `BasketSocket` are provided by this route, and a route's
     * environment injector is cached on the route config: Angular destroys it only
     * under `withExperimentalAutoCleanupInjectors()`, which this app does not enable.
     * So a `DestroyRef` reached from either of those services never fires, and the
     * participant connection outlived the screen by the whole session. This component
     * is destroyed on leaving for certain, which makes it the only honest place to say
     * the shopper has gone.
     */
    inject(DestroyRef).onDestroy(() => {
      this._store.leave();
      // The view store is provided on the same route and has the same problem, so
      // it is let go in the same place. Without this a basket opened later starts
      // on whatever the last one was searched for, and the search is the one thing
      // on this screen that is never remembered (section 4.7).
      this._view.leave();
    });
  }

  protected isBusy(line: BasketLine): boolean {
    return this.busyLines().has(line.id);
  }

  protected openLine(line: BasketLine): void {
    void this._router.navigate(sheetSegments('lines', line.id, 'settle'), {
      relativeTo: this._route,
    });
  }

  /**
   * The row's status control, settling direction: the whole outstanding amount.
   *
   * The same body the sheet's primary button sends, so the two gestures cannot
   * allocate differently. It does not open the allocation pane and it asks nothing
   * about zones: the system allocates oldest origin first exactly as it does when the
   * sheet sends the same body (plan 0052, section 6.4).
   */
  protected settleLine(line: BasketLine): void {
    void this._toggle(line, () =>
      this._store.settle(line.id, { outcome: 'BOUGHT' })
    );
  }

  /** The other direction: a finished line back to fully outstanding. */
  protected reopenLine(line: BasketLine): void {
    void this._toggle(line, () => this._store.reopen(line.id));
  }

  /**
   * Run a row write, and open the sheet on it if it has something to report.
   *
   * **The row cannot draw a skipped origin report**, because it is a paragraph and a
   * row is three short lines. So a write that comes back with `skippedCount > 0` opens
   * the settle sheet on that line, which is where `0051` section 6.4's sentence
   * already lives and where the person can read it beside what they were doing.
   *
   * A failure needs no branch here. It has already moved `BasketStore.state` or is a
   * transient the next refresh resolves, and the row is drawn from the store either
   * way; the sheet is where a failure gets a sentence, and the person opens it.
   */
  private async _toggle(
    line: BasketLine,
    write: () => Promise<{ skippedCount: number } | null>
  ): Promise<void> {
    const result = await write();
    if (result !== null && result.skippedCount > 0) {
      this.openLine(line);
    }
  }

  /**
   * The row's reel was let go: one call, whichever direction it went (plan 0054).
   *
   * **The client never decides whether the drag was a purchase or a raise.** Backend
   * `0056` section 3 makes that decision on numbers only it can see, and a client
   * that decided would get it wrong exactly when two phones are moving one line. So
   * this sends where the gesture ended and where it believed it began, and the
   * answer is a settle result in both directions: a raise answers `skippedCount: 0`,
   * so the skip reporting comes across unchanged and needs no branch.
   */
  protected async setOutstanding(
    line: BasketLine,
    change: { from: number; to: number }
  ): Promise<void> {
    // Whatever the last move of any row came to, gone before this one starts: one
    // sentence at a time across the whole basket, and a stale refusal sitting under
    // a row somebody has since moved again would be a lie about the present.
    this._notice.set(null);

    const result = await this._store.setOutstanding(
      line.id,
      change.to,
      change.from
    );

    if (result === null) {
      this._reportOutstanding(line);
      return;
    }

    // The same sentence the caption showed under the thumb, so a reader who could
    // not see it still learns which of the two happened (section 7).
    this._say(
      outstandingCaption(
        change.from,
        change.to,
        this._translator,
        this._locale()
      ) ?? ''
    );

    if (result.skippedCount > 0) {
      this.openLine(line);
    }
  }

  /**
   * A section's count as the heading draws it, or empty where it has none.
   *
   * "1 of 3 got", in the same words and from the same function as the sentence in
   * the tools row above it, plus "· 1 not available" where a shop had none of
   * something. The unavailable half is a separate key for the reason the page's own
   * sentence keeps it separate: it is a different claim from a purchase, and a
   * heading that folded the two would report a shop that had none as shopping done.
   *
   * Empty for the unheaded section of an ungrouped view, whose count would only
   * repeat the sentence above it. `composeBasketView` decides that, not this.
   */
  protected sectionCount(section: BasketViewSection): string {
    const progress = section.progress;
    if (progress === null) {
      return '';
    }

    const locale = this._locale();
    const got = this._translator.t('basket.group.progress', undefined, locale, {
      done: progress.done,
      total: progress.total,
    });

    if (progress.unavailable === 0) {
      return got;
    }
    return `${got} · ${this._translator.t(
      'basket.group.unavailable',
      undefined,
      locale,
      { count: progress.unavailable }
    )}`;
  }

  /**
   * The whole heading as one accessible name, "Dairy, 1 of 3 got" (section 6).
   *
   * One string rather than a heading whose count is a separate node, because a
   * reader moving by heading hears the `h2` and nothing else in it: a count drawn
   * beside the name would be visible to everybody and announced to nobody.
   *
   * A list's own name goes in as it is. It is the only half of this sentence this
   * app did not write, which is the distinction {@link BasketViewHeading} exists to
   * keep, and a name run through the translator would be looked up as a key.
   */
  protected headingLabel(section: BasketViewSection): string {
    const heading = section.heading;
    if (heading === null) {
      return '';
    }

    const name =
      heading.kind === 'key'
        ? this._translator.t(heading.key, undefined, this._locale())
        : heading.text;
    const count = this.sectionCount(section);
    return count === '' ? name : `${name}, ${count}`;
  }

  /**
   * A row's reel was let go: the whole line, or one household's share of it.
   *
   * Two writes behind one gesture, and **the row does not choose between them**: it
   * reports where the number went and this decides, because the row it belongs to is
   * what carries the origin and the page is what holds the store. A row under a list
   * heading commits that list's own purchase through velista `0073`'s per list write;
   * every other row commits the line's, exactly as it always has.
   */
  protected async setRowOutstanding(
    row: BasketViewRow,
    change: { from: number; to: number }
  ): Promise<void> {
    const origin = row.origin;
    if (origin === null) {
      await this.setOutstanding(row.line, change);
      return;
    }
    await this.setOriginOutstanding(row.line, origin, change);
  }

  /**
   * One household's share of a line moved (velista `0077`, section 4.1).
   *
   * The reel counts what is **still to get** and the write takes what has been
   * **got**, so the two numbers are subtracted from what the list asked for on the
   * way past. `from` is that list's settled count as this screen last read it, which
   * is the same stale check every other write on this page sends: the server refuses
   * a move whose origin no longer matches rather than applying it as the opposite
   * act (backend `0056`, section 3.2).
   *
   * The answer carries the **whole line**, and the store applies it, so the row
   * redraws from what the server now says rather than from the number that was sent.
   * That matters here for `0073`'s own reason: taking back a `NOT_AVAILABLE` close
   * has no units to divide, so the whole close comes back and the number lands above
   * where the control was dragged.
   */
  private async setOriginOutstanding(
    line: BasketLine,
    origin: BasketLineOrigin,
    change: { from: number; to: number }
  ): Promise<void> {
    // One sentence at a time across the whole basket, exactly as `setOutstanding`
    // clears it: a stale refusal under a row somebody has since moved again is a lie
    // about the present.
    this._notice.set(null);

    const result = await this._store.setOriginSettled(line.id, {
      lineId: origin.lineId,
      settled: Math.max(0, origin.quantity - change.to),
      from: origin.settled,
    });

    if (result === null) {
      this._reportOutstanding(line);
      return;
    }

    this._say(
      outstandingCaption(
        change.from,
        change.to,
        this._translator,
        this._locale()
      ) ?? ''
    );

    if (result.skippedCount > 0) {
      this.openLine(line);
    }
  }

  /**
   * Say what went wrong, once, on the row it went wrong on.
   *
   * The count is read back off the store rather than off the line this was called
   * with, and that is the whole of the stale answer: `BasketStore.setOutstanding`
   * refetches before it returns null, so by now the row's number is the true one and
   * "it says 3 now" is a sentence worth saying. Every other failure gets its own
   * sentence the same way, because a failure with no sentence is the defect
   * `basket-error-copy.ts` exists to close (plan 0052, section 7).
   */
  private _reportOutstanding(line: BasketLine): void {
    const key = basketErrorKey(this._store.error(), 'basket.outstanding');
    const found = this.lines().find((row) => row.id === line.id);
    const count = outstanding(found ?? line);

    this._notice.set({ lineId: line.id, key, count });
    this._say(this._translator.t(key, undefined, this._locale(), { count }));
  }

  private _say(sentence: string): void {
    this.outstandingSaid.set(sentence);
  }

  protected openPeople(): void {
    void this._router.navigate(sheetSegments('people'), {
      relativeTo: this._route,
    });
  }

  protected openShare(): void {
    void this._router.navigate(sheetSegments('share'), {
      relativeTo: this._route,
    });
  }

  /**
   * Ask before ending the trip (plan 0057, section 5).
   *
   * Both ways in reach the same sheet: the control in the header, pressed at any
   * point in a trip, and the prompt that appears once every line is settled. Two
   * gestures asking one question, so there is one place the question is written.
   */
  protected openFinish(): void {
    void this._router.navigate(sheetSegments('finish'), {
      relativeTo: this._route,
    });
  }

  /**
   * Take the trip back, from the banner, with **no confirmation** (section 8).
   *
   * The same write as finishing, in the other direction, and the server re-announces
   * the claims (luna `0059`, section 2.2). Nothing is destroyed and the act is
   * trivially repeatable, which is the test `0031` applies before it asks a question,
   * and it is what makes the finish sheet honest: the owner is confirming something
   * reversible, which is why that sheet warns about the people rather than about
   * finality.
   *
   * The basket is refetched rather than waited for over the socket. `generatedList.updated`
   * does arrive, coalesced by a second and a half, and a screen whose controls came
   * back that long after the tap reads as a button that did not work.
   */
  protected async reopenBasket(): Promise<void> {
    this._statusBusy.set(true);
    this._reopenFailed.set(false);

    const landed = await this._generated.setStatus(this._id, 'ACTIVE');
    if (landed) {
      await this._store.refresh();
    }

    this._reopenFailed.set(!landed);
    this._statusBusy.set(false);
  }

  protected retry(): void {
    void this._store.refresh();
  }

  // --- The tools row and the search (plan 0074) -----------------------------

  /**
   * The lines actually drawn, which is the whole basket until somebody searches.
   *
   * Read from {@link BasketViewStore} and never filtered here, because `0075` to
   * `0078` grow the same signal into an order, a filter and a grouping, and a page
   * that did its own narrowing would be a second answer to the same question.
   *
   * {@link progress} is deliberately **not** derived from this. "4 of 12 got" is
   * about the trip and stays about the trip: a search hides rows and changes nothing
   * about how much shopping is left.
   */
  protected readonly visibleLines = this._view.visibleLines;

  /** What is in the search field, for the count and for the no match sentence. */
  protected readonly searchQuery = this._view.query;

  /**
   * Whether anything is being searched for, which decides **which** empty state is
   * drawn: the search's, quoting what was typed, or the filter's (`0075`).
   */
  protected readonly searching = this._view.searching;

  /** The query folded once, handed to every row to draw its `<mark>` from. */
  protected readonly highlight = this._view.folded;

  /**
   * Whether the field has replaced the row, which is not the same as searching.
   *
   * A field that is open and empty draws the whole basket, and the count under it
   * says so. The two questions are separate because opening is a gesture and
   * searching is a string: the field stays open through a query somebody deletes a
   * character at a time, and Cancel is what closes it.
   */
  private readonly _searchOpen = signal(false);

  protected readonly searchOpen = this._searchOpen.asReadonly();

  /**
   * Which control the keyboard should be on once the row has been redrawn.
   *
   * A signal and not a call, because neither control exists at the moment the
   * gesture happens: opening the search destroys the button that was pressed, and
   * cancelling destroys the field. The effect below waits for whichever one arrives.
   */
  private readonly _focusWanted = signal<'field' | 'button' | null>(null);

  private readonly _searchField =
    viewChild<ElementRef<HTMLInputElement>>('searchField');

  private readonly _searchButton =
    viewChild<ElementRef<HTMLButtonElement>>('searchButton');

  /**
   * Put the focus where the gesture said, as soon as there is something to put it
   * on (section 6).
   *
   * Focus never lands on the page body, which is what a naive open and close does:
   * the field takes it when it appears, and Cancel or Escape gives it back to the
   * search button, so a keyboard reader is never dropped at the top of the document
   * in the middle of a basket.
   */
  private readonly _focusEffect = effect(() => {
    const wanted = this._focusWanted();
    const field = this._searchField();
    const button = this._searchButton();

    const target =
      wanted === 'field' ? field : wanted === 'button' ? button : null;
    if (target === undefined || target === null) {
      return;
    }

    untracked(() => this._focusWanted.set(null));
    target.nativeElement.focus();
  });

  /** Replace the row with the field, and put the caret in it. */
  protected openSearch(): void {
    this._searchOpen.set(true);
    this._focusWanted.set('field');
  }

  protected onSearch(event: Event): void {
    this._view.search((event.target as HTMLInputElement).value);
  }

  /** Empty the field without closing it, which is the control inside it. */
  protected clearSearch(): void {
    this._view.search('');
    this._focusWanted.set('field');
  }

  /**
   * Cancel, the scrim of this particular control: Escape does exactly the same.
   *
   * It **clears the query as well as closing the field**, so the row that comes
   * back is over the whole basket. A search left running behind a closed field is a
   * screen missing rows for a reason nothing on it says.
   */
  protected closeSearch(): void {
    this._view.search('');
    this._searchOpen.set(false);
    this._focusWanted.set('button');
  }

  // --- The filter sheet and its chips (plan 0075) ----------------------------

  /**
   * The lines, cut into the sections the page draws (section 3).
   *
   * One section with no heading for an ungrouped, unfiltered basket, which is the
   * ordinary case, so the template's loop over sections is the same list it always
   * drew with one more level around it.
   */
  protected readonly sections = this._view.sections;

  /** How many lines are on the screen, for the chip row's count. */
  protected readonly visibleCount = this._view.visibleCount;

  /** How many of the four properties are on, for the filter button's badge. */
  protected readonly activeCount = this._view.activeCount;

  /**
   * The chips, with their words resolved.
   *
   * Resolved here rather than in `ChipRow`, because each label's arguments come from
   * this screen's state and `ChipRow` knows nothing about baskets; and resolved
   * through the translator service rather than the pipe because this is a list the
   * component computes. The spec asserts the **key and its arguments** through
   * `basketViewChips`, which is pure, so nothing here tests the translator.
   */
  protected readonly chipItems = computed<readonly ChipRowItem[]>(() => {
    const locale = this._locale();
    return this._view.chips().map((chip) => {
      const label = this._translator.t(
        chip.key,
        undefined,
        locale,
        chip.args ?? undefined
      );
      return {
        id: chip.property,
        label,
        // "Remove: A to Z". The chip's own words go inside the name, so a screen
        // reader hears what pressing the x gets rid of rather than "button, x".
        removeLabel: this._translator.t(
          'basket.view.chip.remove',
          undefined,
          locale,
          { name: label }
        ),
      };
    });
  });

  /**
   * The count at the chip row's trailing edge, or null.
   *
   * **Drawn only while fewer lines are shown than the basket holds.** A row saying
   * "12 of 12" next to a chip that reorders is noise: the chips say what is on, and
   * this says what it cost.
   */
  protected readonly chipCount = computed(() => {
    const shown = this.visibleCount();
    const total = this.lines().length;
    if (shown >= total) {
      return null;
    }
    return this._translator.t('basket.view.count', undefined, this._locale(), {
      shown,
      total,
    });
  });

  /**
   * A chip's x: put that one property back to its default.
   *
   * Looked up rather than cast. The id is a property name this page put on the chip,
   * so a cast would be correct today and silent the day a chip carries something
   * else.
   */
  protected removeChip(id: string): void {
    const chip = this._view.chips().find((item) => item.property === id);
    if (chip !== undefined) {
      this._view.resetProperty(chip.property);
    }
  }

  protected openFilter(): void {
    void this._router.navigate(sheetSegments('filter'), {
      relativeTo: this._route,
    });
  }

  // --- The composer (plan 0053) ---------------------------------------------

  /**
   * Whether the field at the bottom is drawn, and it is drawn for **everybody**.
   *
   * That is the unusual part of this screen and not a relaxation of `0030`. The list
   * page draws its composer from certainty, because `myPermissions` arrives with the
   * list and somebody without `WRITE` never sees a field. The basket inverts it:
   * every participant may add a line, guests included, so there is no permission to
   * read and no branch to write. A line added here has no target list, so it changes
   * nothing shared, names no zone and claims no zone line — it is a note on the list
   * somebody is carrying, and the gate that matters is on binding it to a
   * household's list.
   *
   * The one absence is a **finished basket**, where the server refuses the add and a
   * field that cannot submit is the invitation `0038` section 2.1 refuses to draw.
   */
  protected readonly canAdd = this._store.takesLines;

  /** Whether an add is in flight. The field stays usable; only the button waits. */
  protected readonly adding = this._store.adding;

  /**
   * What the composer offers under the field, in the **server's** order.
   *
   * Never re-sorted here, for the reason written on `CatalogApi.suggest`: the client
   * holds none of the prices, scopes or synonyms that decided it.
   */
  protected readonly suggestions = signal<readonly CatalogSuggestion[]>([]);

  /**
   * The newest line to arrive, announced politely and once.
   *
   * One region rather than one per line, which is what makes it bearable when four
   * people add at the same time: a polite region reads whatever the node last held,
   * so simultaneous adds collapse into one sentence (section 8).
   */
  protected readonly announcement = computed(
    () => this._store.lastAdded()?.content ?? ''
  );

  /**
   * The most recent split, said in the **same** region (velista `0069`, section
   * 4).
   *
   * The store sets one of the two and clears the other, so whichever happened
   * last is what the region holds. Null after an add, and null for a split that
   * left one row, which is a sibling folded back into the row it came from:
   * nothing was split, so nothing is said.
   *
   * The new rows need no scroll and no highlight. They carry positions between
   * the original and the line after it, so they are already under the row the
   * shopper was looking at.
   */
  protected readonly splitAnnouncement = this._store.lastSplit;

  private readonly _composer = viewChild(LineComposer);

  /** The last thing typed, which the effect below watches. */
  private readonly _query = signal('');

  protected onComposerQuery(query: string): void {
    this._query.set(query);
  }

  /**
   * Ask the catalog, at most once per {@link SUGGEST_DEBOUNCE_MS} of quiet.
   *
   * **Identical in behaviour to the list page's, deliberately**: somebody who has
   * used velista's list screen must not have to learn a second search. The container
   * owns the debounce, the three character floor and the sequence number, and the
   * composer emits raw keystrokes and knows nothing about requests (rule D1).
   *
   * The sequence number is what makes this correct rather than merely debounced: two
   * requests can be in flight when somebody types through the beat and they can
   * answer out of order, so an older answer must not replace a newer one. Comparing
   * against the query the effect was started for is not enough, since the same text
   * can be typed twice.
   *
   * The request goes to the **participant surface**, because the reader may hold no
   * account token, and it is scoped to the run's own shopping profile rather than to
   * the reader's, so the ranking is the basket's. Both of those are the store's and
   * the gateway's business, not this page's.
   */
  private _suggestSeq = 0;

  private readonly _suggestEffect = effect((onCleanup) => {
    const query = this._query().trim();

    if (query.length < SUGGEST_MIN_CHARS) {
      // Cleared synchronously rather than after the debounce: a dropdown that
      // lingered over a field somebody has just emptied is offering matches for
      // nothing.
      untracked(() => this.suggestions.set([]));
      return;
    }

    const timer = setTimeout(() => {
      const seq = (this._suggestSeq += 1);
      void this._store.suggest(query).then((found) => {
        if (seq === this._suggestSeq) {
          this.suggestions.set(found);
        }
      });
    }, SUGGEST_DEBOUNCE_MS);

    onCleanup(() => clearTimeout(timer));
  });

  /**
   * Add a line, from the field or from a suggestion.
   *
   * **Not optimistic**, which is the opposite of the list page and is the whole of
   * section 7: four people are working this basket at once, and a row that appeared
   * locally and then reordered when the server answered is a row somebody might tap
   * in between. `BasketStore` appends when the server answers, and the socket carries
   * the same line to everybody else.
   *
   * ## What a suggestion attaches
   *
   * The composer hands down `itemIds`: one product for an item suggestion, a group's
   * whole set for a group one. Both become `options`, which is what the line may be
   * switched between; the **pick** is set only where exactly one product was
   * attached, because that is the case where somebody chose a product rather than a
   * kind of thing. A group leaves the pick unset, so the row offers "which one did
   * you get?" at the shelf, which is where that question belongs.
   *
   * A failed add puts the text back in the field. Losing six characters is nothing;
   * losing the item somebody just remembered in an aisle is the failure this screen
   * cannot afford.
   */
  protected async add(entry: {
    content: string;
    quantity: number;
    itemIds?: readonly string[];
  }): Promise<void> {
    const itemIds = entry.itemIds ?? [];
    const line = await this._store.addLine({
      content: entry.content,
      quantity: entry.quantity,
      ...(itemIds.length === 1 ? { itemId: itemIds[0] } : {}),
      ...(itemIds.length > 0 ? { options: itemIds } : {}),
    });

    // The dropdown goes with the words that produced it, whichever way the add
    // went. Clearing it here rather than in the composer keeps the two from
    // disagreeing about whether a list is open.
    this._query.set('');
    this.suggestions.set([]);

    if (line === null) {
      this._composer()?.restore(entry.content);
    }
  }

  /**
   * Back to wherever this was opened from.
   *
   * `PageNavigation`, not a navigation of our own, which is what this used to do:
   * it walked to the history whatever was behind it, so a basket opened from the
   * dashboard card landed on a screen nobody had asked to see, and the back
   * gesture and the button in the corner disagreed about where back is.
   *
   * The history is the **fallback**, for the arrival with nothing behind it — a
   * reload, or a link opened cold — which is exactly the destination this button
   * used to have unconditionally.
   */
  protected back(): void {
    void this._pages.back(
      appPath(this._locale(), this._basePath, BASKET_PATHS.list)
    );
  }
}
