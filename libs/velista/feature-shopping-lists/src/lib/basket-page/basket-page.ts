import { CdkOverlayOrigin } from '@angular/cdk/overlay';
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
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketChangeStore,
  BasketListStore,
  BasketStore,
  BasketTargetStore,
  BasketViewStore,
  SessionStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  basketRowProduct,
  basketShelfMark,
  countableBasketRows,
  isLinkVisitor,
  LINK_VISIT_HOURS,
  selectBasketSurface,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MIN_CHARS,
  VISIT_WARNING_MINUTES,
  type BasketParticipant,
  type BasketProgressSentence,
  type BasketRow as BasketRowModel,
  type BasketViewRow,
  type BasketViewSection,
  type CatalogSuggestion,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  ListSearchNavigation,
  PageNavigation,
  searchOpenOf,
  sheetSegments,
  visitNoticeKey,
} from '@portfolio/velista/platform';
import {
  AnchoredPopover,
  ChangesBanner,
  ChevronLeftIcon,
  ChipRow,
  FlagIcon,
  LineComposer,
  ListTools,
  OfflineIcon,
  PersonIcon,
  ShareIcon,
  VisitNotice,
  type AnchoredPopoverClose,
  type ChipRowItem,
  type SuggestionHolding,
  type SuggestionHoldingChange,
} from '@portfolio/velista/ui';
import { basketErrorKey } from '../basket-error-copy';
import {
  outstandingCaption,
  participantInitials,
  visitTime,
} from '../basket-labels';
import { BASKET_PATHS, basketPath } from '../basket-paths';
import { BasketRow } from '../basket-row/basket-row';
import { TargetListSheet } from '../target-list-sheet/target-list-sheet';
import { ChangeAcknowledger } from './change-acknowledger';
import { SeenTarget } from './seen-target';

/**
 * The longest wait `setTimeout` can actually hold.
 *
 * The delay is a signed 32 bit integer, so anything past about twenty five days
 * overflows and the callback runs **immediately** instead of never. That is the
 * failure worth guarding: an expiry further off than this is not a visit at all,
 * and a timer that fired at once would draw "your time is ending" over a basket
 * with weeks left on it.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

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
 * the lists it was served. Both are also refused server side, so a template
 * mistake is a
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
 * to them. The owner gets one, to the history, and a registered participant gets
 * one to the dashboard.
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
    AnchoredPopover,
    BasketRow,
    CdkOverlayOrigin,
    ChangesBanner,
    ChevronLeftIcon,
    ChipRow,
    SeenTarget,
    FlagIcon,
    LineComposer,
    ListTools,
    OfflineIcon,
    PersonIcon,
    RokuTranslatorPipe,
    RouterOutlet,
    ShareIcon,
    VisitNotice,
  ],
  templateUrl: './basket-page.html',
  styleUrl: './basket-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // On the **component** and not on the route, which is the whole of velista
  // `0093` section 7's placement rule: a route injector is never destroyed, so
  // an acknowledger provided there would outlive this page with a dwell timer
  // running and a set of rows that are not on screen any more. Provided here it
  // dies with the page, and its `DestroyRef` really fires.
  //
  // `BasketChangeStore` is **not** here. It is on the route beside
  // `BasketStore`, because the changes sheet is a child route that is
  // constructed and destroyed while this page stays.
  providers: [ChangeAcknowledger],
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

  /**
   * Where the composer's next line goes (velista `0092`, section 7.2).
   *
   * The fourth store this route provides, and it is a store rather than a signal
   * on this page because it outlives one render of the dock and because it reads
   * and writes this device's memory, which is not a page's business (rule D1).
   */
  /**
   * What changed on the covered lists, for the banner and for the sheet over
   * this page (velista `0093`).
   *
   * Route provided beside {@link BasketStore}, so the sheet reaches the same
   * instance this page reads. Injected here although the page draws none of the
   * entries: the page is what lets it go, because a route provider's own
   * `DestroyRef` never fires.
   */
  private readonly _changes = inject(BasketChangeStore);

  private readonly _target = inject(BasketTargetStore);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  /** For the one thing this page remembers per device: a dismissed notice. */
  private readonly _browser = inject(BrowserFacade);

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
  private readonly _generated = inject(BasketListStore);

  /**
   * Which basket this page was opened for (velista `0091`, section 2.4).
   *
   * `data.basket` is the route saying "the caller's own", which is the only thing
   * the URL cannot: `shopping-lists/live` carries no id, because the id differs
   * for every reader and the server hands it back on the first read. Everything
   * else is a basket named by its id, which is every arrival on a link and every
   * basket somebody else shared.
   */
  private readonly _live = this._route.snapshot.data['basket'] === 'live';

  private readonly _id = this._route.snapshot.paramMap.get('basketId') ?? '';

  protected readonly state = this._store.state;
  protected readonly rows = this._store.rows;

  /**
   * The rows every count on this page is over (velista `0093`, section 4).
   *
   * One selector, so the tools bar's pair and the chip row's pair cannot answer
   * "how many rows are there" differently the day a `REMOVED` row arrives. It
   * never touches the progress sentence, which is the server's numbers and is
   * never recounted here.
   */
  protected readonly countableRows = computed(() =>
    countableBasketRows(this.rows())
  );

  /**
   * How many changes are new to this viewer, straight off the read.
   *
   * Zero draws no banner, and it reaches zero because a basket read said so:
   * this page never decrements it and never hides the banner after a tap
   * (velista `0093`, section 5).
   */
  protected readonly unseenChanges = computed(
    () => this._store.basket()?.unseenChangeCount ?? 0
  );
  protected readonly progress = this._store.progress;

  /**
   * Everything this page draws differently for a `LIVE` basket (velista `0091`,
   * section 3).
   *
   * **One computed, and the template asks it rather than asking `kind`.** There
   * is one basket page: the two kinds differ in a heading, a sentence, four
   * absent controls and two words of an empty state, and a `@if (live)` at each
   * of those places is how the second screen gets built by accident.
   *
   * Null before the first answer, where nothing below the header is drawn
   * anyway; the header's own two controls read it with a fallback that draws
   * neither, because a share control over a basket that has not loaded is a
   * control for a thing nobody can name yet.
   */
  protected readonly surface = computed(() => {
    const basket = this._store.basket();
    return basket === null ? null : selectBasketSurface(basket, basket.me);
  });
  protected readonly busyRows = this._store.busyRows;
  protected readonly participantsById = this._store.participantsById;
  /** The covered lists this reader was served, for the "from" caption on a row. */
  protected readonly lists = this._store.lists;

  /** Only the owner is offered the share control, and only they can use it. */
  protected readonly isOwner = computed(
    () => this._store.me()?.kind === 'OWNER'
  );

  /**
   * Whether this is the basket the bottom bar's basket tab opens (velista `0105`):
   * the permanent one, or the newest basket being shopped, which is where
   * `shopping-lists/current` sends the tab.
   *
   * The same `active()[0]` that redirect reads, so the two cannot disagree about
   * which basket the tab means.
   */
  private readonly _isTabBasket = computed(
    () => this._live || this._id === this._generated.active()[0]?.id
  );

  /**
   * Whether the reader has an app to go back to: the owner, and a registered member of
   * a shared basket. A guest has none, because they arrived on a link and this screen
   * is the whole app to them.
   *
   * Nor on the tab's own basket (velista `0105`). The bottom bar is on screen there
   * with its basket tab lit, so the bar is the way out, and a chevron beside it would
   * be a second one.
   */
  protected readonly canGoBack = computed(() => {
    const kind = this._store.me()?.kind;
    return (kind === 'OWNER' || kind === 'REGISTERED') && !this._isTabBasket();
  });

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
    () => this.surface()?.finish === true
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
    () => this.surface()?.allDone === true
  );

  /**
   * The sentence above the rows, which is a different sentence per kind
   * (velista `0091`, section 4).
   *
   * A `GENERATED` basket counts a trip that ends. A `LIVE` one says what is left
   * first, because "3 of 40 got" on a basket that is never finished is true and
   * reads as a failure. Which of the four it is belongs to the model, and the
   * fallback below is only ever read before the first answer, where the row that
   * draws it is not on screen.
   */
  protected readonly progressLine = computed<BasketProgressSentence>(
    () =>
      this.surface()?.progress ?? {
        key: 'basket.progress',
        args: { done: 0, total: 0 },
        unavailable: 0,
      }
  );

  /** One line under the heading, or null. Only the `LIVE` basket has one. */
  protected readonly hint = computed(() => this.surface()?.hintKey ?? null);

  /** What an empty basket says, which is about what put lines in it. */
  protected readonly emptyTitle = computed(
    () => this.surface()?.emptyTitleKey ?? 'basket.empty'
  );

  protected readonly emptyBody = computed(
    () => this.surface()?.emptyBodyKey ?? 'basket.emptyHint'
  );

  /**
   * Whether the finished banner is drawn at all.
   *
   * Separate from {@link finished}, which also takes the controls off every row:
   * a `LIVE` basket is never finished, so the two happen to agree today, and
   * they are two questions and are asked separately.
   */
  protected readonly finishedBanner = computed(
    () => this.surface()?.finishedBanner === true
  );

  /** Whether the reader is offered the share sheet. The owner, on both kinds. */
  protected readonly canShare = computed(() => this.surface()?.share === true);

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
   * Read once here rather than in {@link BasketRow}, which is constructed once per
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

    // The permanent basket has no name to give and never will, so its heading is
    // words this app owns: "Everything to buy", or whose everything it is
    // (velista `0091`, section 3). The surface decides which, because deciding it
    // here would be the second place that reads `kind`.
    const title = this.surface()?.title;
    if (title !== undefined && title.kind === 'key') {
      return this._translator.t(
        title.key,
        undefined,
        this._locale(),
        title.args
      );
    }

    if (basket.name !== null && basket.name !== '') {
      return basket.name;
    }
    const at = basket.createdAt;
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

  // --- The visit, while it runs and after it ends (velista `0094`) -----------

  /**
   * Whether this reader is on the basket with the link, and until when.
   *
   * Null for the owner and for anybody the owner added by name, which is most
   * readers on most screens: nothing below is drawn for them at all.
   */
  private readonly _visit = computed<Date | null>(() => {
    const me = this._store.me();
    return me !== null && isLinkVisitor(me) ? me.expiresAt : null;
  });

  /**
   * Whether the arrival notice has been dismissed on this device, for this
   * basket.
   *
   * A signal mirroring `sessionStorage` rather than reading it in the computed,
   * because a read there would not re-run when the value is written. It is a
   * **convenience and never a rule**: storage that is blocked, cleared or
   * simply empty means the notice is drawn again, which costs a sentence
   * somebody has already read.
   */
  private readonly _visitDismissed = signal(false);

  /**
   * Whether the end is near enough to insist on (section 5).
   *
   * A signal rather than a computed over the clock, because there is no signal
   * for "time passed": a computed reading `Date.now()` is recomputed only when
   * something else it reads moves, so a basket nobody touches would cross the
   * threshold silently. {@link _armWarning} is what moves it.
   */
  private readonly _visitEnding = signal(false);

  /**
   * The timer that moves {@link _visitEnding}, held so it can be cleared.
   *
   * **Owned by this component**, which is the whole reason it lives here rather
   * than in the store: a route provider's `DestroyRef` never fires in this app,
   * and a timer set in one would outlive the screen it belongs to. A component
   * is destroyed for certain.
   */
  private _warningAt: ReturnType<typeof setTimeout> | null = null;

  /**
   * The owner's name, for the half of the sentence that says whom to ask.
   *
   * Null when the basket carries no name for them, which is a basket generated
   * before luna `0054` backfilled usernames. The nameless form of each sentence
   * exists for exactly that, rather than printing "Ask Owner".
   */
  private readonly _ownerName = computed<string | null>(() => {
    const owner = this._store
      .participants()
      .find((person: BasketParticipant) => person.kind === 'OWNER');
    const name = owner?.username?.trim() || owner?.displayName?.trim();
    return name === undefined || name === '' ? null : name;
  });

  /**
   * The notice under the header while a visit is running, or null.
   *
   * Four sentences and one component. An account holder is told whom to ask,
   * because being added by name is what would keep them; a guest is told the
   * time and nothing else, because keeping it takes an account and **rule C2 is
   * that a guest is never shown register**. The warning is the same sentence
   * one shape on, and it carries no dismiss label, which is what makes it
   * insistent.
   */
  protected readonly visitNotice = computed<{
    readonly text: string;
    readonly dismissLabel: string | null;
  } | null>(() => {
    const endsAt = this._visit();
    if (endsAt === null) {
      return null;
    }

    const ending = this._visitEnding();
    if (!ending && this._visitDismissed()) {
      return null;
    }

    const locale = this._locale();
    const time = visitTime(endsAt, this._translator, locale);
    const name = this._ownerName();
    const guest = this._store.me()?.kind === 'GUEST';

    const key = ending
      ? 'basket.visit.ending'
      : guest
        ? 'basket.visit.guest'
        : name === null
          ? 'basket.visit.accountNameless'
          : 'basket.visit.account';

    return {
      text: this._translator.t(key, undefined, locale, {
        time,
        ...(name === null ? {} : { name }),
      }),
      // The warning cannot be dismissed. It is the last thing said before
      // somebody loses the basket they are shopping from.
      dismissLabel: ending
        ? null
        : this._translator.t('basket.visit.dismiss', undefined, locale),
    };
  });

  /**
   * Which sentence the ended state says (section 5).
   *
   * `REMOVED` and `UNKNOWN` share one, which is the reason `UNKNOWN` exists: a
   * refusal that named no cause draws the ordinary one rather than claiming a
   * visit ran out. `EXPIRED` splits again on whether the reader has an account,
   * because only an account can be added by name, and offering that to a guest
   * would be rule C2's invitation by another route.
   */
  protected readonly endedNotice = computed<{
    readonly titleKey: string;
    readonly bodyKey: string;
    readonly args: Readonly<Record<string, string | undefined>>;
  }>(() => {
    const removed = {
      titleKey: 'basket.revoked.title',
      bodyKey: 'basket.revoked.body',
      args: {},
    };

    if (this._store.accessEnded() !== 'EXPIRED') {
      return removed;
    }

    if (this._store.me()?.kind === 'GUEST') {
      return {
        titleKey: 'basket.ended.title',
        bodyKey: 'basket.ended.bodyGuest',
        args: {},
      };
    }

    const name = this._ownerName();
    return {
      titleKey: 'basket.ended.title',
      bodyKey:
        name === null
          ? 'basket.ended.bodyAccountNameless'
          : 'basket.ended.bodyAccount',
      args: name === null ? {} : { name },
    };
  });

  /** How long a link lasts, for the sentences that name the number. */
  protected readonly visitHours = LINK_VISIT_HOURS;

  /** Forget the arrival notice for this basket, on this device only. */
  protected dismissVisit(): void {
    this._visitDismissed.set(true);
    const key = this._visitNoticeKey();
    if (key !== null) {
      this._browser.writeSessionStorage(key, '1');
    }
  }

  /**
   * Where this basket's dismissal is remembered, or null before the id is
   * known.
   *
   * Per basket rather than one key for the app, following `basketTargetKey`'s
   * reasoning: somebody shopping two shared baskets in a week has two visits,
   * and dismissing one says nothing about the other.
   */
  private _visitNoticeKey(): string | null {
    const id = this._store.basket()?.id ?? null;
    return id === null ? null : visitNoticeKey(id);
  }

  /**
   * Set the one timer that turns the warning on, and clear any earlier one.
   *
   * Recomputed on every basket read, because an expiry moves: keeping somebody
   * clears it entirely, and rejoining pushes it out. A moment already past arms
   * nothing and sets the flag, and a moment further off than a timer can hold
   * is left alone rather than firing immediately, which is what a naive
   * `setTimeout` of more than about twenty five days does.
   */
  private _armWarning(endsAt: Date | null): void {
    this._clearWarning();

    if (endsAt === null) {
      this._visitEnding.set(false);
      return;
    }

    const warnAt = endsAt.getTime() - VISIT_WARNING_MINUTES * 60 * 1000;
    const wait = warnAt - Date.now();
    if (wait <= 0) {
      this._visitEnding.set(true);
      return;
    }

    this._visitEnding.set(false);
    if (wait > MAX_TIMEOUT_MS) {
      return;
    }
    this._warningAt = setTimeout(() => {
      this._warningAt = null;
      this._visitEnding.set(true);
    }, wait);
  }

  private _clearWarning(): void {
    if (this._warningAt !== null) {
      clearTimeout(this._warningAt);
      this._warningAt = null;
    }
  }

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
    readonly rowKey: string;
    readonly key: string;
    readonly count: number;
  } | null>(null);

  /** The notice for this row, or null. Identity is stable, so the row is not redrawn. */
  protected noticeFor(
    row: BasketRowModel
  ): { readonly key: string; readonly count: number } | null {
    const notice = this._notice();
    return notice !== null && notice.rowKey === row.rowKey ? notice : null;
  }

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
   *
   * **Named from the participant row where there is one.** A presence entry carries no
   * username, so a face built from the entry alone fell through to the role word and
   * drew `O` or `M`, while the people sheet, built from participants, drew the
   * username's letter for the same person.
   */
  protected readonly faces = computed(() => {
    const meId = this.meId();
    const ownName = this._session.username();
    const participants = new Map(
      this._store.participants().map((person) => [person.id, person])
    );

    // Nothing at all on a basket with no presence room (backend `0130`, section
    // 7). The signal is empty for one anyway, and this says so on purpose: an
    // empty row and a row that must not be drawn are two different facts, and
    // the day a `LIVE` basket gains presence this is the line to delete.
    if (this.surface()?.presence !== true) {
      return [];
    }

    return this._store
      .present()
      .slice(0, 3)
      .map((entry) => {
        const person = participants.get(entry.participantId) ?? entry;
        return {
          id: entry.participantId,
          initials: participantInitials(
            person,
            this._translator,
            this._locale(),
            { ownName: entry.participantId === meId ? ownName : null }
          ),
          isGuest: person.kind === 'GUEST',
        };
      });
  });

  /**
   * Whether there is anybody to read about in the people sheet.
   *
   * Not the same question as {@link faces}. Presence empties when the socket drops
   * and when everybody has gone home, and in both cases the sheet still answers
   * something worth knowing — everybody who *can* open this basket — so the way into
   * it has to survive the face row going away.
   *
   * **No longer asks about presence** (velista `0094`, section 7). It used to,
   * which meant the basket that is always there had no way into the sheet at
   * all: a `LIVE` basket has no presence room, so the condition was false for
   * it whatever its participant list said. A `LIVE` basket can be shared and can
   * have named people on it, so the sheet has an answer worth reading and the
   * header keeps the door to it. What is gated on presence is the **faces**,
   * which are a claim about who is here right now.
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
    void (
      this._live ? this._store.openLive() : this._store.open(this._id)
    ).then(() => {
      this._view.restore();
      // The target is checked against the refs that just arrived, for the same
      // reason and at the same moment: a remembered list this reader no longer
      // writes is not in `Basket.lists` any more, and the chip must stop naming
      // it. `restore` drops it silently and keeps the record, because the list
      // may come back on the next read.
      const basket = this._store.basket();
      if (basket !== null) {
        this._target.restore(basket);
      }
    });

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
    /**
     * The visit, re-read on every basket read (velista `0094`, section 5).
     *
     * An expiry **moves**: the owner keeping somebody clears it, and opening
     * the link again pushes it out, so the one timer is set from whatever the
     * last read said rather than once on arrival. The dismissal is read here
     * too, because the basket's id is what the key is built from and under
     * `live` that id arrives with the answer.
     */
    effect(() => {
      const endsAt = this._visit();
      const id = this._store.basket()?.id ?? null;
      untracked(() => {
        this._armWarning(endsAt);
        const key = id === null ? null : visitNoticeKey(id);
        this._visitDismissed.set(
          key !== null && this._browser.readSessionStorage(key) !== null
        );
      });
    });

    inject(DestroyRef).onDestroy(() => {
      // The one timer this page owns. A route provider's `DestroyRef` never
      // fires in this app, so a timer set in the store would outlive the screen
      // and flip a signal for a basket nobody is looking at.
      this._clearWarning();
      this._store.leave();
      // The view store is provided on the same route and has the same problem, so
      // it is let go in the same place. Without this a basket opened later starts
      // on whatever the last one was searched for, and the search is the one thing
      // on this screen that is never remembered (section 4.7).
      this._view.leave();
      // The third one on this route, let go in the same place for the same
      // reason: a route provider's own `DestroyRef` never fires. The **record**
      // survives, which is the whole point of writing it down; what is dropped is
      // this page's hold on it.
      this._target.leave();
      // The fourth one on this route, for the same reason: without this a
      // basket opened later starts holding the previous basket's changes.
      this._changes.reset();
    });
  }

  protected isBusy(row: BasketRowModel): boolean {
    return this.busyRows().has(row.rowKey);
  }

  protected openRow(row: BasketRowModel): void {
    void this._router.navigate(sheetSegments('rows', row.rowKey, 'settle'), {
      relativeTo: this._route,
      queryParams: this._search.kept(this._route),
    });
  }

  /**
   * The row's status control, settling direction: everything it still asks for.
   *
   * The same body the sheet's primary button sends, so the two gestures cannot
   * allocate differently. **With an explicit quantity**, which backend `0136`
   * requires, and with `from` beside it, which is what makes a double tap safe: the
   * second tap names a number the first one moved, and the server refuses it.
   *
   * It asks nothing about lists: the server divides the units oldest entry first,
   * exactly as it does when the sheet sends the same body.
   */
  protected settleRow(row: BasketRowModel): void {
    void this._toggle(row, () =>
      this._store.settle(row.rowKey, {
        outcome: 'BOUGHT',
        quantity: row.left,
        from: row.left,
        ...this._settleAt(row),
      })
    );
  }

  /**
   * Where a settle from the row happened and what it bought, as a body fragment to
   * spread (velista `0095`, section 6; `0102`).
   *
   * The scope of the price the row draws, and the shop the person is buying at,
   * both from `BasketViewStore.settleShop`, which the settle sheet asks too. And the
   * option the row offers in place of a default the shop is known not to have:
   * the row names it, so the settle buys it.
   *
   * The row on this page is bound with no product anybody chose, so this asks the
   * same question with the same answer: what is sent is what the row drew.
   */
  private _settleAt(row: BasketRowModel): {
    itemId?: string;
    priceScopeId?: string;
    supermarketLocationId?: string;
  } {
    const instead = this.insteadOf(row);
    return {
      ...(instead === null ? {} : { itemId: instead }),
      ...this._view.settleShop(basketRowProduct(row, this.products(), instead)),
    };
  }

  /**
   * The option this row offers in place of a default the chosen shop is known not
   * to have, or null (velista `0102`).
   *
   * What the row draws as its product, and what a settle from the row buys. The
   * page binds the row with it as the product in the trolley, because the row says
   * so: "Instead of Danone griego, not available at this shop".
   */
  protected insteadOf(row: BasketRowModel): string | null {
    const shelf = basketShelfMark(
      row,
      this.products(),
      this._view.readAtShop()
    );
    return shelf?.kind === 'instead' ? shelf.optionId : null;
  }

  /**
   * The other direction: take this row's purchases, or its close, back.
   *
   * Which of the two is the **state's** to say and never this page's. A row the shop
   * had none of holds no units to give back, so reverting it takes the close; a row
   * somebody bought gives the units back. Sending the wrong one would be refused,
   * and deciding it here from two numbers is the arithmetic velista `0090` removed.
   */
  protected revertRow(row: BasketRowModel): void {
    void this._toggle(row, () =>
      this._store.revert(
        row.rowKey,
        row.state === 'NOT_AVAILABLE'
          ? { target: 'CLOSE' }
          : { target: 'UNITS', units: row.bought, from: row.bought }
      )
    );
  }

  /**
   * Run a row write, and open the sheet on it if it has something to report.
   *
   * **The row cannot draw what a write could not reach**, because it is a sentence
   * and a row is three short lines. So a write that comes back with
   * `skippedCount > 0` opens the settle sheet on that row, where the sentence
   * already lives and where the person can read it beside what they were doing.
   *
   * A failure needs no branch here. It has already moved `BasketStore.state` or is a
   * transient the next refresh resolves, and the row is drawn from the store either
   * way; the sheet is where a failure gets a sentence, and the person opens it.
   */
  private async _toggle(
    row: BasketRowModel,
    write: () => Promise<{ skippedCount: number } | null>
  ): Promise<void> {
    const result = await write();
    if (result !== null && result.skippedCount > 0) {
      this.openRow(row);
    }
  }

  /**
   * The row's reel was let go: one call, whichever direction it went (plan 0054).
   *
   * **The client never decides whether the drag was a purchase or a take back.**
   * `BasketStore.setLeft` turns the pair of numbers into a settle or a revert, and it
   * is the one place that decision lives, so the row, the entries pane and this
   * cannot disagree. What this page owns is the sentence a refusal leaves behind.
   *
   * Under a list heading the row is drawn for one entry, and moving its reel is
   * still a write on the **row**: the units it settles are allocated to that
   * household through `allocations`, which is velista `0092`'s to draw from the
   * entries pane. Until then the reel under a heading commits against the row and
   * the server divides oldest entry first, which is what it did before a heading
   * existed.
   */
  protected async setRowLeft(
    row: BasketViewRow,
    change: { from: number; to: number }
  ): Promise<void> {
    // Whatever the last move of any row came to, gone before this one starts: one
    // sentence at a time across the whole basket, and a stale refusal sitting under
    // a row somebody has since moved again would be a lie about the present.
    this._notice.set(null);

    const result = await this._store.setLeft(
      row.row.rowKey,
      change.to,
      change.from,
      this._settleAt(row.row)
    );

    if (result === null) {
      this._reportLeft(row.row);
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
      this.openRow(row.row);
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
        ? this._translator.t(
            heading.key,
            undefined,
            this._locale(),
            // What the sentence interpolates, which is `0078`'s sink alone: "Not
            // listed at Mercadona" names a chain inside words this app owns.
            heading.args
          )
        : heading.text;
    const count = this.sectionCount(section);
    return count === '' ? name : `${name}, ${count}`;
  }

  /**
   * Say what went wrong, once, on the row it went wrong on.
   *
   * The count is read back off the store rather than off the row this was called
   * with, and that is the whole of the stale answer: `BasketStore.setLeft`
   * refetches before it returns null, so by now the row's number is the true one and
   * "it says 3 now" is a sentence worth saying. Every other failure gets its own
   * sentence the same way, because a failure with no sentence is the defect
   * `basket-error-copy.ts` exists to close (plan 0052, section 7).
   */
  private _reportLeft(row: BasketRowModel): void {
    const key = basketErrorKey(this._store.error(), 'basket.outstanding');
    // Found again rather than trusted: a `stale_quantity` refetch can land a
    // re-keyed row, and the number to report is that row's as it now stands.
    const found = this._store.rowFor(row.rowKey);
    const count = (found ?? row).left;

    this._notice.set({ rowKey: row.rowKey, key, count });
    this._say(this._translator.t(key, undefined, this._locale(), { count }));
  }

  private _say(sentence: string): void {
    this.outstandingSaid.set(sentence);
  }

  /**
   * Say what a sheet handed over on its way out (velista `0092`, section 6.2).
   *
   * A demand taken to zero takes the row out of the basket, the sheet over it
   * dismisses itself, and this page is what is left with a live region. The
   * sheet composed the sentence, because it held the name of the row it was
   * about; this only says it, in the **same** region every other sentence on
   * this screen goes through, so two of them cannot talk over each other while
   * somebody is standing in an aisle.
   *
   * An effect rather than a computed, because saying something is an act: the
   * region already holds whatever was said last, and a computed folded into it
   * would re-say the old sentence every time anything else on the page moved.
   */
  private readonly _handOver = effect(() => {
    const said = this._store.handedOver();
    if (said !== null) {
      untracked(() => this._say(said.text));
    }
  });

  protected openPeople(): void {
    void this._router.navigate(sheetSegments('people'), {
      relativeTo: this._route,
      queryParams: this._search.kept(this._route),
    });
  }

  protected openShare(): void {
    void this._router.navigate(sheetSegments('share'), {
      relativeTo: this._route,
      queryParams: this._search.kept(this._route),
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
      queryParams: this._search.kept(this._route),
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
   * The basket is refetched rather than waited for over the socket. `basket.updated`
   * does arrive, coalesced by a second and a half, and a screen whose controls came
   * back that long after the tap reads as a button that did not work.
   */
  protected async reopenBasket(): Promise<void> {
    this._statusBusy.set(true);
    this._reopenFailed.set(false);

    // The id off the basket rather than off the URL: this control is the owner's
    // on a generated basket, where the two agree, and one source cannot drift.
    const landed = await this._generated.setStatus(
      this._store.basket()?.id ?? this._id,
      'OPEN'
    );
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
  protected readonly visibleLines = this._view.visibleRows;

  /** What is in the search field, for the count and for the no match sentence. */
  protected readonly searchQuery = this._view.query;

  /**
   * Whether anything is being searched for, which decides **which** empty state is
   * drawn: the search's, quoting what was typed, or the filter's (`0075`).
   */
  protected readonly searching = this._view.searching;

  /** The query folded once, handed to every row to draw its `<mark>` from. */
  protected readonly highlight = this._view.folded;

  /** What was typed, or the empty string from Clear. */
  protected search(query: string): void {
    this._view.search(query);
  }

  private readonly _search = inject(ListSearchNavigation);

  /**
   * Whether the search field is open, which is `?search=1` (velista `0109`).
   *
   * In the URL so the phone's back button closes the search rather than leaving the
   * basket: opening pushes the parameter, and back pops it.
   */
  protected readonly searchOpen = searchOpenOf(this._route);

  /** The search button opens, and Cancel and Escape go back. */
  protected setSearchOpen(open: boolean): void {
    void (open
      ? this._search.open(this._route)
      : this._search.close(this._route));
  }

  /**
   * The query goes when the field does, whichever way it closed, so the row that
   * comes back is over the whole basket.
   */
  private _searchWasOpen = false;

  private readonly _clearClosedSearch = effect(() => {
    const open = this.searchOpen();
    const was = this._searchWasOpen;
    this._searchWasOpen = open;
    if (was && !open) {
      untracked(() => this._view.search(''));
    }
  });

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

  /**
   * Whether the usual filter is what left nothing on the screen, which draws its
   * own empty state rather than the filter's (velista `0104`).
   */
  protected readonly usualHidesAll = this._view.usualHidesAll;

  /** The usual empty state's one button: the switch, off (velista `0104`). */
  protected showEveryLine(): void {
    this._view.setUsual(false);
  }

  /**
   * How many rows the tools bar says are shown.
   *
   * {@link visibleCount} with the `REMOVED` rows taken out, which is the same
   * rule the total follows: a search or a filter treats such a row like any
   * other and may well leave it standing, and a bar reading "13 of 12" is what
   * counting it on one side alone produces.
   *
   * {@link visibleCount} itself stays as it is, because it answers a different
   * question: whether there is anything on screen at all, which decides between
   * the rows and the "nothing matched" block.
   */
  protected readonly shownCount = computed(
    () => countableBasketRows(this.visibleLines()).length
  );

  /**
   * Whether every row quotes the chosen shop's price, or the cheapest anywhere
   * (`0078`; `0102`).
   *
   * Asked once for the whole basket and handed to each row, which is what this page
   * already does with `canReopen` and its own name: a component built once per line
   * has no business asking the same question a dozen times.
   */
  protected readonly pricedAtShop = this._view.pricedAtShop;

  /** How many of the five properties are on, for the filter button's badge. */
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
        // A locked chip removes nothing, so it names what it is and why instead
        // (velista `0102`).
        removeLabel: this._translator.t(
          chip.locked === true
            ? 'basket.view.chip.lockedLabel'
            : 'basket.view.chip.remove',
          undefined,
          locale,
          { name: label }
        ),
        ...(chip.locked === true ? { locked: true } : {}),
      };
    });
  });

  /**
   * The count at the chip row's trailing edge, or null.
   *
   * **Drawn only while fewer rows are shown than the basket holds.** A row saying
   * "12 of 12" next to a chip that reorders is noise: the chips say what is on, and
   * this says what it cost.
   */
  protected readonly chipCount = computed(() => {
    const shown = this.shownCount();
    // The rows a shopper is working through, which is every row that is not
    // `REMOVED`: one somebody took off the basket is information about it rather
    // than a thing the filter is hiding, and counting it would make an unfiltered
    // basket report fewer rows than it holds. One selector for every count on
    // this page, so the two pairs cannot disagree (velista `0093`, section 4).
    const total = this.countableRows().length;
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

  /** Read what changed, in words (velista `0093`, section 6). */
  protected openChanges(): void {
    void this._router.navigate(sheetSegments('changes'), {
      relativeTo: this._route,
      queryParams: this._search.kept(this._route),
    });
  }

  protected openFilter(): void {
    void this._router.navigate(sheetSegments('filter'), {
      relativeTo: this._route,
      queryParams: this._search.kept(this._route),
    });
  }

  // --- The composer (plan 0053, velista `0092` section 7) --------------------

  /**
   * Whether the field at the bottom is drawn, and **who no longer gets one**.
   *
   * Three conditions, and the middle one is velista `0092` reversing velista
   * `0053` section 2:
   *
   * - the basket is open, because a finished one refuses the add and a field
   *   that cannot submit is the invitation `0038` section 2.1 will not draw;
   * - the reader holds an **account**, which is `OWNER` or `REGISTERED`;
   * - `Basket.lists` is not empty, which is the covered lists this reader may
   *   write.
   *
   * A guest was given the composer because "an added line has no target, so it
   * changes nothing shared". Every line has a target now, so that safety argument
   * is gone and the control goes with it. **No dock, no field and no sentence
   * about it**: `0038` section 2.1 refuses to draw an invitation that cannot be
   * accepted, and the product rule that a guest is never pushed to register
   * forbids explaining why.
   *
   * The third condition is not a second way of saying the second. A registered
   * co shopper on somebody else's basket may hold `WRITE` on none of its lists,
   * and then there is nowhere for their line to go.
   */
  protected readonly canAdd = computed(() => {
    const kind = this._store.me()?.kind;
    return (
      !this.finished() &&
      (kind === 'OWNER' || kind === 'REGISTERED') &&
      this._store.lists().size > 0
    );
  });

  /** Whether an add is in flight. The field stays usable; only the button waits. */
  protected readonly adding = this._store.adding;

  /**
   * The list the next line goes to, or null while none is chosen.
   *
   * Null is reachable only on a basket covering more than one list this reader
   * writes: one list chooses itself, which is `BasketTargetStore.restore`'s
   * business rather than this page's.
   */
  protected readonly target = this._target.target;

  /**
   * Whether the chip above the field is a button.
   *
   * With one list in `Basket.lists` it is **text**: there is nothing to pick
   * between, and a button opening a sheet with one row on it would be asking a
   * question with one answer (`0030`).
   */
  protected readonly canRetarget = computed(() => this._store.lists().size > 1);

  protected openTarget(): void {
    // The chip is the popover's way out now that the popover holds no button of
    // its own (velista 0113), and a press on the chip is not a press outside: the
    // overlay counts its origin, the dock, as part of itself. So it is closed
    // here, or it would stay drawn above the sheet's scrim.
    this.needsListOpen.set(false);
    void this._router.navigate(sheetSegments('add', 'list'), {
      relativeTo: this._route,
      queryParams: this._search.kept(this._route),
    });
  }

  /**
   * Whether the popover saying a list comes first is up (velista `0110`).
   *
   * Drawn only while there is still no target, so choosing a list closes it
   * without anything here having to watch for that.
   */
  protected readonly needsListOpen = signal(false);

  /**
   * Set for the moment this page hands focus back to the locked field itself, so
   * the focus it causes is not read as somebody asking why the field is locked.
   */
  private _quietFocus = false;

  /** The locked field was tapped or focused. */
  protected openNeedsList(): void {
    if (!this._quietFocus) {
      this.needsListOpen.set(true);
    }
  }

  /**
   * The popover asked to close. On Escape, focus goes back to the field when it
   * had moved into the popover, which is where it was before the popover opened.
   * A press outside leaves focus wherever that press put it.
   */
  protected closeNeedsList(reason: AnchoredPopoverClose): void {
    if (!this.needsListOpen()) {
      return;
    }
    this.needsListOpen.set(false);
    if (reason === 'escape') {
      this._refocusField();
    }
  }

  /**
   * A sheet's route went (velista `0113`). When it was the target sheet and a
   * list was chosen on it, the next thing to do is type, so focus goes to the
   * composer's field.
   *
   * Here and not in the sheet, because this is the moment the sheet is gone: its
   * fall has finished and nothing of it is left to hold focus. The sheet hands
   * focus back only on Escape and the scrim, to whatever opened it, which is the
   * chip and not the field. A dismissal without a choice is left to that.
   *
   * Quietly, so the focus is not read as a tap on a locked field. The target was
   * set before the sheet closed, so the popover has nothing to say by now anyway.
   * A target set by `restore` on arrival never passes through here, and moves no
   * focus.
   */
  protected onSheetDeactivated(sheet: unknown): void {
    if (sheet instanceof TargetListSheet && sheet.chose) {
      this.needsListOpen.set(false);
      this._refocusField();
    }
  }

  private _refocusField(): void {
    this._quietFocus = true;
    try {
      this._composer()?.focusField();
    } finally {
      this._quietFocus = false;
    }
  }

  /**
   * What the composer offers under the field, in the **server's** order.
   *
   * Never re-sorted here, for the reason written on `CatalogApi.suggest`: the
   * client holds none of the prices, scopes or synonyms that decided it.
   */
  protected readonly suggestions = signal<readonly CatalogSuggestion[]>([]);

  /**
   * The catalog is being asked, for the composer's skeleton cards (velista `0101`).
   * The list page's rule, for the reason the search itself is the list page's.
   */
  protected readonly suggesting = signal(false);

  /**
   * The words {@link suggestions} answer, or null when nothing has been asked. The
   * list page's rule (velista `0108`): the composer's no results row and a group
   * card's synonym both read it.
   */
  protected readonly suggestedFor = signal<string | null>(null);

  /**
   * The lines in this basket already holding what a card offers (velista `0101`,
   * section 4): one per entry of every row whose products name it, because the same
   * product reaches the basket from several lists.
   *
   * The words are the row's, since an entry carries none of its own, and the list
   * above them is named only where this reader was served that list. How many is the
   * entry's `left`, and the stepper moves only where the server says that entry's
   * demand may change. A group is held by nothing here: a basket row names products,
   * not the group a line followed.
   */
  protected readonly holdingsOf = computed(() => {
    const rows = this._store.rows();
    const lists = this._store.lists();
    return (suggestion: CatalogSuggestion): readonly SuggestionHolding[] => {
      if (suggestion.kind !== 'item') {
        return [];
      }
      return rows
        .filter((row) => row.optionIds.includes(suggestion.item.id))
        .flatMap((row) =>
          row.entries.map((entry) => ({
            key: `${row.rowKey}:${entry.lineId}`,
            lineId: entry.lineId,
            text: row.content,
            listName:
              entry.listId === null
                ? null
                : (lists.get(entry.listId)?.name ?? null),
            quantity: entry.left,
            editable: entry.demandEditable,
          }))
        );
    };
  });

  /**
   * Where a card's "Details" opens a product: the product sheet, over this basket
   * (velista `0107`), so the basket stays underneath and closing the sheet lands
   * back on it. Null for a guest, because every catalog read needs an account and a
   * link that ends on a sign in wall is not a way through to the product.
   */
  protected readonly productLink = computed(() => {
    if (this._store.me()?.kind === 'GUEST') {
      return null;
    }
    const page = basketPath(
      this._locale(),
      this._basePath,
      this._store.address()
    );
    return (itemId: string): string =>
      `${page}/${sheetSegments('products', itemId).join('/')}`;
  });

  /**
   * A card's stepper moved one list's demand (velista `0101`, section 2): the write
   * the settle sheet makes, `POST rows/{rowKey}/demand`, and the same sentences
   * after it. The row is found again by the line, because a row's key can change
   * under the panel while somebody else adds or settles.
   */
  protected async changeHolding(
    change: SuggestionHoldingChange
  ): Promise<void> {
    const row = this._store
      .rows()
      .find((candidate) =>
        candidate.entries.some(
          (entry) => entry.lineId === change.holding.lineId
        )
      );
    if (row === undefined) {
      return;
    }

    const result = await this._store.setDemand(row.rowKey, {
      lineId: change.holding.lineId,
      quantity: change.to,
      from: change.from,
    });

    if (result === null) {
      this._say(
        this._translator.t(
          basketErrorKey(this._store.error(), 'basket.demand'),
          undefined,
          this._locale(),
          { count: change.from }
        )
      );
      return;
    }

    if (result.row === null) {
      this._say(
        this._translator.t(
          'basket.demand.nothingLeft',
          undefined,
          this._locale(),
          { name: change.holding.text }
        )
      );
    }
  }

  /**
   * What arrived, said once, in the **same** region every other sentence on this
   * screen goes through.
   *
   * One region rather than one per line, which is what makes it bearable when
   * four people add at the same time: a polite region reads whatever the node
   * last held, so simultaneous adds collapse into one sentence.
   *
   * The split's sentence is gone from it along with the split (velista `0069`,
   * removed by `0090`), which is why there is no second branch here any more.
   */
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
   * used velista's list screen must not have to learn a second search. The
   * container owns the debounce, the three character floor and the sequence
   * number, and the composer emits raw keystrokes and knows nothing about
   * requests (rule D1).
   *
   * The sequence number is what makes this correct rather than merely debounced:
   * two requests can be in flight when somebody types through the beat and they
   * can answer out of order, so an older answer must not replace a newer one.
   * Comparing against the query the effect was started for is not enough, since
   * the same text can be typed twice.
   *
   * The request goes to the **participant surface**, because the reader may hold
   * no account token, and it is scoped to the basket's own shopping profile
   * rather than to the reader's. Both of those are the store's business.
   */
  private _suggestSeq = 0;

  private readonly _suggestEffect = effect((onCleanup) => {
    const query = this._query().trim();

    // No list to add to, no request (velista `0110`). The field is locked then and
    // cannot be typed into, so this is the belt: a suggestion offered with nowhere
    // to put it is the thing that plan removed.
    if (query.length < SUGGEST_MIN_CHARS || this.target() === null) {
      // Cleared synchronously rather than after the debounce: a dropdown that
      // lingered over a field somebody has just emptied is offering matches for
      // nothing.
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
      void this._store.suggest(query).then((found) => {
        if (seq === this._suggestSeq) {
          this.suggestions.set(found);
          this.suggestedFor.set(query);
          this.suggesting.set(false);
        }
      });
    }, SUGGEST_DEBOUNCE_MS);

    onCleanup(() => clearTimeout(timer));
  });

  /**
   * Add a line, from the field or from a suggestion (velista `0092`,
   * section 7.4).
   *
   * **It names a list, and the add goes through that list's own rules.** So it
   * can land on a line the list already held (backend `0091`), and it can land
   * unapproved on a list that does not auto approve — in which case the row is
   * drawn with its caption, is buyable, and differs in nothing else. The person
   * who typed "batteries" sees batteries.
   *
   * **Not optimistic**, which is the opposite of the list page and is velista
   * `0053` section 7 unchanged: four people are working this basket at once, and
   * a row that appeared locally and then moved when the server answered is a row
   * somebody might tap in between. The store folds the answered row.
   *
   * A failed add puts the text back in the field. Losing six characters is
   * nothing; losing the item somebody just remembered in an aisle is the failure
   * this screen cannot afford.
   */
  protected async add(entry: {
    content: string;
    quantity: number;
    itemIds?: readonly string[];
  }): Promise<void> {
    const target = this.target();
    if (target === null) {
      // The submit is disabled without one, so this is the belt: an add with no
      // list is a line with nowhere to be.
      return;
    }

    const itemIds = entry.itemIds ?? [];
    const result = await this._store.addLine({
      targetListId: target.listId,
      content: entry.content,
      quantity: entry.quantity,
      ...(itemIds.length > 0 ? { itemIds } : {}),
    });

    // The dropdown goes with the words that produced it, whichever way the add
    // went. Clearing it here rather than in the composer keeps the two from
    // disagreeing about whether a list is open.
    this._query.set('');
    this.suggestions.set([]);

    if (result === null) {
      this._composer()?.restore(entry.content);
      this._say(
        this._translator.t(
          basketErrorKey(this._store.error(), 'basket.addLine'),
          undefined,
          this._locale()
        )
      );
      return;
    }

    this._say(
      this._translator.t('basket.added.announced', undefined, this._locale(), {
        content: result.row?.content ?? entry.content,
      })
    );
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
   *
   * A member's fallback is the dashboard instead. The history lists the reader's own
   * baskets, and a basket somebody shared with them is not one of those.
   */
  protected back(): void {
    void this._pages.back(
      this.surface()?.back === 'history'
        ? appPath(this._locale(), this._basePath, BASKET_PATHS.list)
        : appPath(this._locale(), this._basePath, 'home')
    );
  }
}
