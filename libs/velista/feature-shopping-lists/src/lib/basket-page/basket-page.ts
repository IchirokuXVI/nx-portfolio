import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type BasketLine } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';
import { BasketLineRow } from '../basket-line-row/basket-line-row';
import { participantName } from '../basket-labels';
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
 * shopper's phone is most likely to be behind somebody else's. Live updates need
 * the basket's realtime room, which needs a socket a guest can open, and that is
 * the one part of section 6 not built yet.
 */
@Component({
  selector: 'lib-basket-page',
  imports: [BasketLineRow, RokuTranslatorPipe, RouterOutlet],
  templateUrl: './basket-page.html',
  styleUrl: './basket-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketPage {
  private readonly _store = inject(BasketStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

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
   * The faces along the top, and how many there are.
   *
   * **No sentence.** "Three anonymous users are shopping with you" was considered
   * and dropped for being a paragraph where a row does the job, and the word
   * anonymous appears nowhere in this product: they are guests (section 5.1).
   */
  protected readonly faces = computed(() =>
    this._store
      .participants()
      .slice(0, 3)
      .map((person) => ({
        id: person.id,
        initials: participantName(
          person,
          this._translator,
          this._locale()
        ).slice(0, 2),
        isGuest: person.kind === 'GUEST',
      }))
  );

  /** The overflow count, collapsing into a stacked chip like the price display. */
  protected readonly overflow = computed(() =>
    Math.max(0, this._store.participants().length - 3)
  );

  constructor() {
    void this._store.open(this._id);
  }

  protected isBusy(line: BasketLine): boolean {
    return this.busyLines().has(line.id);
  }

  protected openLine(line: BasketLine): void {
    void this._router.navigate(['lines', line.id, 'settle'], {
      relativeTo: this._route,
    });
  }

  protected openPeople(): void {
    void this._router.navigate(['people'], { relativeTo: this._route });
  }

  protected openShare(): void {
    void this._router.navigate(['share'], { relativeTo: this._route });
  }

  protected retry(): void {
    void this._store.refresh();
  }

  /** Back to the history, which only somebody with an account has. */
  protected back(): void {
    void this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, BASKET_PATHS.list)
    );
  }
}
