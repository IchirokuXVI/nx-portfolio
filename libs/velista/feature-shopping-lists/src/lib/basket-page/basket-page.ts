import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, SessionStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type BasketLine } from '@portfolio/velista/models';
import {
  appPath,
  PageNavigation,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  ChevronLeftIcon,
  OfflineIcon,
  PersonIcon,
  ShareIcon,
} from '@portfolio/velista/ui';
import { participantInitials } from '../basket-labels';
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
    OfflineIcon,
    PersonIcon,
    RokuTranslatorPipe,
    RouterOutlet,
    ShareIcon,
  ],
  templateUrl: './basket-page.html',
  styleUrl: './basket-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketPage {
  private readonly _store = inject(BasketStore);
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

  /** The reader's own participant id, so their own edits read as "you". */
  protected readonly meId = computed(() => this._store.me()?.id ?? null);

  protected readonly products = computed(
    () => this._store.basket()?.products ?? new Map()
  );

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
    void this._store.open(this._id);

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
    inject(DestroyRef).onDestroy(() => this._store.leave());
  }

  protected isBusy(line: BasketLine): boolean {
    return this.busyLines().has(line.id);
  }

  protected openLine(line: BasketLine): void {
    void this._router.navigate(sheetSegments('lines', line.id, 'settle'), {
      relativeTo: this._route,
    });
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

  protected retry(): void {
    void this._store.refresh();
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
