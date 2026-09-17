import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  effect,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  GatewayError,
  LINE_SERVICE,
  SessionStore,
  toBasketMergeRequired,
  type LineServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  formatDay,
  inLocale,
  LINE_CONTENT_MAX_LENGTH,
  outstanding,
  toSettlementRow,
  type BasketLine,
  type BasketParticipant,
  type BasketPriceScope,
  type BasketSettleResult,
  type SettlementOutcome,
  type SettlementRowVm,
} from '@portfolio/velista/models';
import {
  formatMoney,
  generatedListIdOf,
  lineIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import {
  CheckIcon,
  QuantityReel,
  SheetShell,
  SpinnerIcon,
} from '@portfolio/velista/ui';
import {
  basketErrorArgs,
  basketErrorKey,
  correlationIdOf,
  type BasketOperation,
} from '../basket-error-copy';
import { participantName, touchedCaption } from '../basket-labels';
import { basketPath, settleSheetPath } from '../basket-paths';
import { LineListsSummary } from '../line-lists-summary/line-lists-summary';

/**
 * Where a price is from, as one line under the option's name (velista `0062`,
 * section 5.1): the chain, and the first shop when the reader has one.
 *
 * Null for a scope the basket does not describe, which is a partially failed
 * gateway composition and draws no place under a price that is still a price.
 * A scope with more than one location names the first and does not enumerate
 * them: a list of four addresses on each of eleven options is a wall, and which
 * of a chain's shops somebody is standing in is not a question this sheet can
 * answer. The place takes no translation key; it is server data joined by the
 * separator the app already uses.
 */
function placeOf(
  scope: BasketPriceScope | undefined,
  locale: string
): string | null {
  if (!scope) {
    return null;
  }
  const chain = inLocale(scope.supermarketName, locale);
  const shop = scope.locations[0];
  if (!shop) {
    return chain;
  }
  const label = shop.label ? inLocale(shop.label, locale) : '';
  const where = label !== '' ? label : (shop.address ?? shop.city ?? '');
  return where !== '' ? `${chain} · ${where}` : chain;
}

/**
 * Which pane of the sheet is showing.
 *
 * One sheet with three panes rather than three sheets, because they are one
 * gesture at progressively more precision (section 4.2) and because a person in
 * an aisle should reach any of them in one tap from the row: three routes would
 * make the precise ones two taps and a navigation away from the number they were
 * about to type.
 */
type Pane = 'settle' | 'quantity' | 'product' | 'history' | 'merge';

/**
 * One row of the merge question (velista `0084`, section 4): a place the name is
 * taken, and what the other line there holds. The words around the number are the
 * template's, so a row carries the key and the number rather than a sentence.
 */
interface MergeRow {
  readonly key: string;
  /** The list, or null for the basket row, whose label is a translation key. */
  readonly listName: string | null;
  readonly zoneName: string;
  readonly amountKey: 'basket.rename.mergeAsks' | 'basket.rename.mergeToGet';
  readonly quantity: number;
}

/** The merge question: the name that was typed, and every place it is taken. */
interface MergeQuestion {
  readonly name: string;
  readonly rows: readonly MergeRow[];
}

/** How the settlement history's read has got on. Four states, not two booleans. */
type HistoryLoad = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * Settling one line: the whole amount, a number, or per household (plan 0044,
 * section 4.2).
 *
 * ## The two buttons, and why the first is one tap
 *
 * **Settle closes the whole outstanding amount** and is the common case, so it is
 * the largest control and takes one tap. **Partial submit asks for a number** and
 * is available to everybody, guests included, because it asks nothing about
 * zones. Neither mentions a list: a guest is never asked which household a tin of
 * tomatoes belongs to, and the system allocates oldest origin first.
 *
 * ## What every list asked for and got, under the product (velista `0073`)
 *
 * There were two more controls here and they are both gone. **Allocate** was a pane
 * saying who got how many of what was just bought; **Change what each list asked
 * for** opened a second sheet saying who wanted how many. They were the same rows
 * drawn twice, in two places nobody found.
 *
 * What replaced them is `LineListsSummary`, drawn under the product entry for a
 * reader who passes the all or nothing rule: one row per list, both numbers, both
 * controls. A guest sees the sheet without it and settles the whole line or part of
 * it through the buttons exactly as before.
 *
 * **The settle buttons never wait for it** (section 3.4). It owns its own read and
 * draws its own loading and failure states, so a shopper who opened the sheet to
 * press "Got all" is not held up by a question about lists.
 *
 * ## Not available is here, and it is not a quantity
 *
 * It closes the outstanding amount without claiming anything was bought, which is
 * why it sits beside the two settle buttons and ignores whatever number is in the
 * stepper.
 *
 * ## What a settle can leave behind
 *
 * An origin whose access has moved since the basket was made is skipped and
 * **reported** rather than failing the whole act (backend `0051`, section 6.4). A
 * reader who passes the rule is told which lists; everybody else is told only how
 * many, because the names are zone data. Both are drawn: a shopper who has
 * already bought the thing has to know something did not land.
 *
 * ## What happened here, and who may read it
 *
 * The fifth pane is the line's **settlement history** (plan 0049, section 1.1), which
 * `0044` section 4.1 has always listed among what an owner and a passing registered
 * participant see and which no screen drew. Attribution on a row answers who; this
 * answers what happened in what order, which is the question after a trip where two
 * people bought against one line.
 *
 * A pane rather than a sheet of its own, for the reason the other three are: somebody
 * in an aisle reaches it in one tap from the row, where a route of its own would cost
 * two taps and a navigation.
 *
 * It reads a **different surface** from everything else here — the account
 * authenticated, zone scoped `GET /v1/lines/:id/settlements` rather than the
 * participant authenticated basket — which is exactly why `0044` skipped it, and why
 * the control is drawn only for a reader who holds an account and passes the all or
 * nothing rule. A guest never sees it, and could not use it if a template mistake drew
 * one: they have no account token to present.
 *
 * **Privilege is checked per request and never cached at join** (backend `0051`).
 * `seesZoneData` is the server's answer on the most recent basket read, so a
 * participant who loses `WRITE` loses the control on the next one, and the request
 * behind it is refused by the gateway regardless of what is on screen.
 */
@Component({
  selector: 'lib-settle-sheet',
  imports: [
    CheckIcon,
    LineListsSummary,
    QuantityReel,
    RokuTranslatorPipe,
    SheetShell,
    SpinnerIcon,
  ],
  templateUrl: './settle-sheet.html',
  styleUrl: './settle-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettleSheet {
  private readonly _store = inject(BasketStore);
  /**
   * The zone list line surface, for the settlement history and nothing else.
   *
   * The one place this sheet reaches past the basket. It is account authenticated where
   * everything else here is participant authenticated, which is the whole reason the
   * history is gated (plan 0049, section 1.1).
   */
  private readonly _lines = inject<LineServiceI>(LINE_SERVICE);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  /**
   * The account, for the one name the basket does not carry: the reader's own.
   *
   * Null for a guest, who has no account and whose own row the server does name.
   */
  private readonly _session = inject(SessionStore);

  /** The basket underneath, which is where closing this sheet goes. */
  private readonly _generatedListId = generatedListIdOf(this._route);

  /**
   * The line, as a signal and not a snapshot (velista `0084`).
   *
   * A merge can leave this sheet's line behind, and the sheet then follows the
   * survivor with `leaveTo` onto its own route with another `lineId`. The router
   * reuses this component for that URL, so a snapshot read once would keep
   * describing the line that is gone.
   */
  private readonly _lineIdParam = lineIdOf(this._route);
  private get _lineId(): string {
    return this._lineIdParam();
  }
  private readonly _injector = inject(Injector);
  private readonly _pane = signal<Pane>('settle');
  private readonly _settling = signal(false);
  /**
   * Which act failed, or null if none has (plan 0052, section 7.2).
   *
   * An **operation and not a boolean**, which is the whole of the change. This was
   * `_failed: signal(false)` and drew one sentence, `basket.settle.failed`, for every
   * failure the screen can suffer: the backend said something specific and the screen
   * said "That did not save. Try again." `forbidden` and `conflict` each mean several
   * things here, so the copy is keyed on the code **and** what was being attempted,
   * and this is the second half of that key.
   */
  private readonly _failedOp = signal<BasketOperation | null>(null);
  private readonly _result = signal<BasketSettleResult | null>(null);

  private readonly _history = signal<readonly SettlementRowVm[]>([]);
  private readonly _historyState = signal<HistoryLoad>('idle');
  /** The next cursor per origin line, so `Show more` knows what is left to ask. */
  private readonly _historyCursors = signal<ReadonlyMap<string, string>>(
    new Map()
  );

  protected readonly pane = this._pane.asReadonly();
  /**
   * Whether a write from this sheet is out, a settle or a rename. While one is, the
   * settle controls are disabled and the sheet cannot be dismissed.
   */
  protected readonly busy = computed(() => this._settling() || this.saving());
  protected readonly result = this._result.asReadonly();

  /**
   * What to say about the last failure, or null when there has not been one.
   *
   * The code comes from {@link BasketStore.error}, which already holds the last
   * failure and is already exposed, and the operation from {@link _failedOp}. The
   * server's own `message` is deliberately not used: the gateway's catalog gives every
   * code one message, so it reads identically for every conflict in the product.
   */
  protected readonly errorKey = computed<string | null>(() => {
    const operation = this._failedOp();
    return operation === null
      ? null
      : basketErrorKey(this._store.error(), operation);
  });

  /** The support reference, drawn beside a failure that has one. */
  protected readonly correlationId = computed<string | null>(() =>
    this._failedOp() === null ? null : correlationIdOf(this._store.error())
  );
  protected readonly seesZoneData = this._store.seesZoneData;
  protected readonly history = this._history.asReadonly();
  protected readonly historyState = this._historyState.asReadonly();
  protected readonly historyHasMore = computed(
    () => this._historyCursors().size > 0
  );

  /** The line this sheet is about, read live so a settle updates it under us. */
  protected readonly line = computed<BasketLine | null>(
    () => this._store.lines().find((row) => row.id === this._lineId) ?? null
  );

  /**
   * Whether this sheet has already left, so it leaves exactly once.
   *
   * A field and not a signal: nothing draws it, and an effect that wrote a signal
   * it also reads would be a loop.
   */
  private _left = false;

  constructor() {
    // A sheet about a line that is gone dismisses itself (velista `0069`, section
    // 3.1; `0031`). Moving every unit of a sibling back to the product that
    // already has a row folds the sibling away, and the sheet over it is then
    // about nothing: a back gesture would land on it, and the pane's controls
    // would send writes for an id the server no longer holds. The same handling
    // covers a removal that arrives over the socket, which is a second phone
    // doing the same thing.
    effect(() => {
      // Only once the basket has actually been read. Before that every line is
      // absent, and dismissing then would close the sheet somebody deep linked
      // to before it ever drew.
      // Nor while a rename is out or following its survivor (velista `0084`). A
      // merge that absorbs this line takes it out of the store before the answer
      // reaches this sheet, and the sheet then leaves for the survivor itself.
      if (
        this._left ||
        this.saving() ||
        this._following() ||
        this._store.state() !== 'ready' ||
        this.line() !== null
      ) {
        return;
      }
      this._left = true;
      this.close();
    });
  }

  protected readonly outstanding = computed(() => {
    const line = this.line();
    return line === null ? 0 : outstanding(line);
  });

  /**
   * Whether this line has nothing left to settle (plan 0052, section 7.1).
   *
   * A finished line is still tappable, deliberately: `0043` section 3.2 keeps it in
   * place so somebody can look at what they bought. So this sheet opens on one, and
   * every settle target on it was a control that could not work. The plural rule
   * picked `all_other` for a count of zero and the button read **"Got all 0"**, and
   * pressing either it or "They had none" sent a settle that core refuses, because
   * `generated-list-settle.service.ts` throws when `outstanding === 0`.
   *
   * **A control you may not use is not drawn** (`0030`), so this is what the settle
   * pane branches its targets on rather than a disabled state.
   */
  protected readonly finished = computed(
    () => this.line() !== null && this.outstanding() === 0
  );

  /**
   * Whether the **trip** is over, which is a different fact from {@link finished}
   * (velista `0057`, section 6).
   *
   * That one is about this line and this one is about the basket around it, and the
   * pair is why both names spell out which they mean. A finished trip takes the
   * controls off every line at once, the ones nobody settled included: those are not
   * being bought, not being dropped and not being recorded as anything, and this
   * sheet is where somebody reads what happened to them.
   */
  protected readonly basketFinished = this._store.finished;

  /**
   * Whether to draw the settle targets at all.
   *
   * The two ways of having nothing to settle, in one place, because the template
   * asks the question once and a control drawn from either half alone would be an
   * invitation the server refuses. A control you may not use is not drawn (`0030`).
   */
  protected readonly canSettle = computed(
    () => !this.finished() && !this.basketFinished()
  );

  /**
   * What happened to this line, in one sentence, for a finished one.
   *
   * The **same** sentence `touchedCaption` composes for the row, so the sheet and the
   * row underneath it cannot disagree about what a person did. Null for a line nobody
   * has touched, which a finished line never is, and for one that was edited rather
   * than settled.
   */
  protected readonly whatHappened = computed<string | null>(() => {
    const line = this.line();
    return line === null
      ? null
      : touchedCaption(
          line,
          this._store.participantsById(),
          this._translator,
          this._locale(),
          this._store.me()?.id ?? null,
          this._session.username()
        );
  });

  /**
   * What the reel holds, for the partial submit.
   *
   * Starts at one rather than at the outstanding amount: somebody who wanted the
   * whole amount pressed the other button, so the number they are about to give is
   * by definition a smaller one.
   *
   * It follows the reel's `preview` as well as its commit, so "Record it" reads the
   * number under the thumb straight away rather than after the reel's idle beat. A
   * button whose label disagreed with the number above it for a second would be
   * asking somebody in a shop to wait and find out.
   */
  protected readonly typed = signal(1);

  /**
   * The reel's ceiling: what is outstanding, and never less than its floor.
   *
   * A finished line has nothing outstanding, and the settle pane draws no way into
   * this one for exactly that reason (`finished`), so the floor here is a guard
   * against an impossible range rather than a case somebody can reach.
   */
  protected readonly quantityMax = computed(() =>
    Math.max(1, this.outstanding())
  );

  /**
   * The number under the thumb, while it is down.
   *
   * Null means the overlay closed, and the reel is showing {@link typed} again, so
   * there is nothing to copy across.
   */
  protected onQuantityPreview(next: number | null): void {
    if (next !== null) {
      this.typed.set(next);
    }
  }

  /** The picked product's name, for the line under the title. */
  protected readonly productName = computed<string | null>(() => {
    const pickId = this.line()?.pickId ?? null;
    const product =
      pickId === null ? undefined : this._store.basket()?.products.get(pickId);
    return product ? inLocale(product.name, this._locale()) : null;
  });

  /**
   * Every product this line may be switched to, named and priced, **in the
   * order given** (velista `0062`, section 5).
   *
   * The order is the line's own option order and never changes: sorting by
   * price would move rows under the thumb of somebody reading them at a shelf,
   * and reorder the list every time a harvest changed a number. The cheapest is
   * *marked* instead, and only when at least two options are priced, because on
   * one priced option the mark says nothing and looks like a recommendation.
   * The mark lands on the cheapest and not on the pick, which is the useful
   * case: the sheet shows in one glance that the default is not the cheapest.
   *
   * Every string is decided here and carried on the row (`price`, `unitPrice`,
   * `place`), so a row that has decided what it says cannot say it differently
   * on a re render. `noPrice` is drawn only in a mix (section 5.3): when no
   * option is priced the pane is exactly today's pane, and when some are, the
   * blank one has to say it is unknown rather than free.
   *
   * There is **no branch on who is reading**. The place is whatever the scope
   * carries: the chain, and the first shop when the server sent any. A guest
   * reads "Mercadona" and an owner reads "Mercadona · Ronda de los Tejares",
   * and this component cannot tell which it is drawing (section 6).
   */
  protected readonly options = computed(() => {
    const line = this.line();
    const basket = this._store.basket();
    if (line === null || basket === undefined || basket === null) {
      return [];
    }
    const locale = this._locale();
    const { products, scopes } = basket;

    const rows = line.optionIds.flatMap((id) => {
      const product = products.get(id);
      // A product catalog no longer has is dropped rather than drawn as an id:
      // a basket outlives the catalog it was composed from.
      if (!product) {
        return [];
      }
      const offer = product.offer;
      const priced = offer !== null && offer.price !== null;
      return [
        {
          id,
          name: inLocale(product.name, locale),
          brand: product.brand,
          chosen: id === line.pickId,
          price: priced
            ? formatMoney(offer.price, offer.currency, locale)
            : null,
          amount: priced ? offer.price : null,
          unitPrice:
            offer !== null && offer.unitPrice !== null
              ? `${formatMoney(offer.unitPrice, null, locale)} ${offer.unitPriceLabel ?? ''}`.trim()
              : null,
          place:
            offer === null
              ? null
              : placeOf(scopes.get(offer.priceScopeId), locale),
          cheapest: false,
          noPrice: false,
        },
      ];
    });

    const pricedRows = rows.filter((row) => row.amount !== null);
    if (pricedRows.length === 0) {
      return rows;
    }
    const cheapest =
      pricedRows.length >= 2
        ? pricedRows.reduce((best, row) =>
            (row.amount ?? Infinity) < (best.amount ?? Infinity) ? row : best
          )
        : null;
    return rows.map((row) => ({
      ...row,
      cheapest: row === cheapest,
      noPrice: row.amount === null,
    }));
  });

  /**
   * What the outstanding amount was when the product pane was opened.
   *
   * The pane's whole arithmetic runs off this one number rather than off
   * {@link outstanding}, and that is deliberate. It is what goes out as the
   * write's `from`, so the balance a shopper reads and the amount the server
   * checks are the same fact: a pane whose steppers were capped by a live number
   * while `from` held an older one could show a legal move that the server then
   * refuses. Somebody else moving the line underneath is exactly what the guard
   * is for, and it answers `stale_quantity`, which reloads the pane.
   */
  private readonly _from = signal(0);

  /** Units put against each product other than the line's own, by product id. */
  private readonly _shares = signal<ReadonlyMap<string, number>>(new Map());

  /**
   * What the line's own product keeps: everything the steppers did not take.
   *
   * A computed and never a control, which is the rule the pane is built on. The
   * balance is never typed, so the sum can never exceed what is outstanding and
   * a stale request can only land somewhere honest (backend `0094`, section 2).
   */
  protected readonly balance = computed(() => {
    const given = [...this._shares().values()].reduce((sum, n) => sum + n, 0);
    return Math.max(0, this._from() - given);
  });

  /**
   * The product pane's rows: every option, with what it has been given and how
   * much more it may take.
   *
   * The ceiling is the balance **plus this row's own value**, which is what makes
   * a stepper reversible: raising one lowers every other row's ceiling by the same
   * amount, and lowering it gives the room back. The sum can never exceed the
   * outstanding amount and the balance can never read below zero.
   *
   * Built on {@link options} rather than beside it, so the name, the price and
   * the place a row draws are decided in exactly one place (velista `0062`).
   */
  protected readonly productRows = computed(() => {
    const shares = this._shares();
    const balance = this.balance();
    return this.options().map((row) => {
      const share = shares.get(row.id) ?? 0;
      return { ...row, share, max: balance + share };
    });
  });

  /**
   * The balance's own row at the top of the pane, or null when an option holds
   * it.
   *
   * Drawn for a line whose product no option row can show: a group added line
   * that was never picked (backend `0055`, section 3), and a line whose product
   * the catalog has since dropped, which {@link options} leaves out rather than
   * drawing as an id. Both need somewhere for the rest to go, and a shopper needs
   * to see what an unpicked remainder means.
   *
   * `name` is null only in the first case, which is the one that reads "no
   * product chosen": the second has a name and simply has no row of its own.
   */
  protected readonly restRow = computed<{ name: string | null } | null>(() =>
    this.options().some((row) => row.chosen)
      ? null
      : { name: this.productName() }
  );

  /** Whether anything has been moved, which is what the commit waits on. */
  protected readonly moved = computed(() =>
    [...this._shares().values()].some((quantity) => quantity > 0)
  );

  /**
   * How old the prices on the pane are, once, under it (section 5.4): the
   * oldest `observedAt` among the options shown, and whether the server
   * flagged any of them stale, in the same sentence. Null when nothing is
   * priced, so the pane draws nothing.
   *
   * The flag is read, never inferred (backend plan 0080, section 5). This used
   * to say "entered by hand" from `sourceKind === 'ADMIN'` and let the oldest
   * date stand for freshness, and neither can know the policy: a typed price
   * has no maximum age, so an old one is not stale, while a crawl price a week
   * old is. The server decides and this draws it. The date still travels, for
   * display.
   *
   * The two are interpolated keys, so what is held here is the key and its
   * argument rather than a sentence: the template hands both to the pipe.
   */
  protected readonly pricesAsOf = computed<{
    key: 'basket.product.asOf' | 'basket.product.asOfStale';
    when: string;
  } | null>(() => {
    const line = this.line();
    const basket = this._store.basket();
    if (line === null || !basket) {
      return null;
    }
    let oldest: Date | null = null;
    let stale = false;
    for (const id of line.optionIds) {
      const offer = basket.products.get(id)?.offer;
      if (!offer || offer.price === null) {
        continue;
      }
      if (offer.stale) {
        stale = true;
      }
      if (offer.observedAt && (oldest === null || offer.observedAt < oldest)) {
        oldest = offer.observedAt;
      }
    }
    if (oldest === null) {
      return null;
    }
    return {
      key: stale ? 'basket.product.asOfStale' : 'basket.product.asOf',
      when: formatDay(oldest, this._locale()),
    };
  });

  /**
   * Whether this reader may read what happened to the line (plan 0049, section 1.1).
   *
   * Two conditions, and they are two because they are two different facts. The reader
   * must hold an **account**, since the settlement route authenticates one and a guest
   * has none to present; and they must pass the **all or nothing rule**, which is
   * `WRITE` on every source list of the run as the server evaluated it on the most
   * recent basket read. The owner satisfies both by owning the basket.
   *
   * A control you may not use is not drawn (`0030`), so this decides whether the way
   * into the pane exists at all rather than whether it is disabled. Losing `WRITE`
   * flips `seesZoneData` on the next basket read and the control goes with it, which
   * is the per request check working rather than a second copy of it.
   */
  protected readonly canReadHistory = computed(
    () => this._store.seesZoneData() && this._store.me()?.kind !== 'GUEST'
  );

  /** The sheet's accessible title, which is the line's own words. */
  protected readonly title = computed(() => this.line()?.content ?? '');

  // --- Renaming the line (velista `0084`) ------------------------------------

  /**
   * Whether to draw the name field in place of the title (section 2).
   *
   * The owner, on any line. A registered participant who sees zone data, on a line
   * with origins: backend `0113` lets them rename exactly the lines whose every list
   * they can write, and `seesZoneData` is that answer for every list of the run. A
   * guest never. Nobody once the trip is finished, like every other control here.
   *
   * This only decides whether the field is drawn. The server asks again on the save,
   * and its refusal is what the sheet then shows.
   */
  protected readonly canRename = computed(() => {
    const line = this.line();
    const me = this._store.me();
    if (line === null || me === null || this.basketFinished()) {
      return false;
    }
    if (me.kind === 'OWNER') {
      return true;
    }
    return (
      me.kind === 'REGISTERED' &&
      this._store.seesZoneData() &&
      (line.origins ?? []).length > 0
    );
  });

  /** The longest name the server takes, on the field. */
  protected readonly maxLength = LINE_CONTENT_MAX_LENGTH;

  /** What the name field holds. */
  protected readonly name = signal('');

  /** Whether a rename is out. The field is read only and the settle controls wait. */
  protected readonly saving = signal(false);

  /** Whether the last save landed and nothing has been typed since (section 3). */
  protected readonly saved = signal(false);

  /** The refusal under Save, or null. A merge question is a pane instead. */
  protected readonly renameErrorKey = signal<string | null>(null);
  protected readonly renameErrorArgs = signal<
    Readonly<Record<string, unknown>>
  >({});
  /** The support reference, beside the generic sentence only. */
  protected readonly renameReference = signal<string | null>(null);

  /** The merge question while it is being asked (section 4). */
  protected readonly merge = signal<MergeQuestion | null>(null);

  /**
   * Whether the sheet is following a merge's survivor to its own URL. The sheet's
   * own line is already gone from the store by then, and it must not close.
   */
  private readonly _following = signal(false);

  /**
   * The name the field was last filled with from the line, so a change from
   * somebody else redraws a field the reader has not touched and leaves one they
   * have.
   */
  private _shown: string | null = null;

  private readonly _document = inject(DOCUMENT);

  private readonly _saveButton =
    viewChild<ElementRef<HTMLButtonElement>>('saveButton');
  private readonly _mergeTitle =
    viewChild<ElementRef<HTMLElement>>('mergeTitle');
  private readonly _titleHeading =
    viewChild<ElementRef<HTMLElement>>('titleHeading');

  /** Whether the trimmed name differs from the line and is not blank (section 3). */
  protected readonly canSave = computed(() => {
    const line = this.line();
    const typed = this.name().trim();
    return (
      this.canRename() &&
      line !== null &&
      typed !== '' &&
      typed !== line.content &&
      !this.busy()
    );
  });

  /**
   * Fills the field from the line, and follows the line while the reader has not
   * typed. Not while a save is out: the store applies the answer before the sheet
   * reads it, and the sheet fills the field from that answer itself.
   */
  private readonly _seedName = effect(() => {
    const content = this.line()?.content;
    if (content === undefined || this.saving()) {
      return;
    }
    untracked(() => {
      const typed = this.name();
      if (this._shown === null || typed === this._shown || typed === content) {
        this.name.set(content);
        this._shown = content;
      }
    });
  });

  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.saved.set(false);
  }

  /** Save, from the button or Enter in the field. */
  protected async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    await this._rename(false);
  }

  /** Merge, from the question: the same rename with `confirmMerge`. */
  protected async confirmMerge(): Promise<void> {
    if (this.busy() || this.merge() === null) {
      return;
    }
    await this._rename(true);
  }

  /** Back to the settle pane, with the typed name still in the field. */
  protected keepEditing(): void {
    this.merge.set(null);
    this._pane.set('settle');
    afterNextRender(() => this._saveButton()?.nativeElement.focus(), {
      injector: this._injector,
    });
  }

  private async _rename(confirmMerge: boolean): Promise<void> {
    const lineId = this._lineId;
    const content = (this.merge()?.name ?? this.name()).trim();

    this.saving.set(true);
    this._failedOp.set(null);
    this.renameErrorKey.set(null);
    this.renameErrorArgs.set({});
    this.renameReference.set(null);

    const result = await this._store.renameLine(
      lineId,
      confirmMerge ? { content, confirmMerge: true } : { content }
    );

    if (result !== null && result.line.id !== lineId) {
      // Before `saving` drops, so the dismissal effect never sees this line gone
      // and unheld.
      this._following.set(true);
    }
    this.saving.set(false);

    if (result === null) {
      this._refused(this._store.error(), content);
      return;
    }

    this.merge.set(null);
    this._pane.set('settle');
    this.saved.set(true);
    // From the answer: a merge keeps the survivor's own spelling.
    this.name.set(result.line.content);
    this._shown = result.line.content;

    if (result.line.id !== lineId) {
      // This line was absorbed. The reader stays on the line that remains.
      await this._sheet.leaveTo(
        settleSheetPath(
          this._locale(),
          this._basePath,
          this._generatedListId(),
          result.line.id
        )
      );
      this._following.set(false);
    }

    if (confirmMerge) {
      // The pane holding the focused button is gone. Focus stays in the dialog.
      afterNextRender(() => this._titleHeading()?.nativeElement.focus(), {
        injector: this._injector,
      });
    } else {
      this._keepFocusInside();
    }
  }

  /**
   * Put focus back in the dialog when the save took it away.
   *
   * Save is disabled while the write is out and again once the name matches the
   * line, and a disabled button drops focus to the page body, where Escape no longer
   * reaches the sheet. Found in the browser check: the sheet would not close. The
   * title and not the field, because focusing a field opens the phone's keyboard.
   */
  private _keepFocusInside(): void {
    afterNextRender(
      () => {
        const active = this._document.activeElement;
        if (active === null || active === this._document.body) {
          this._titleHeading()?.nativeElement.focus();
        }
      },
      { injector: this._injector }
    );
  }

  /** A refused rename: the merge question, or a sentence under Save. */
  private _refused(error: unknown, name: string): void {
    const question = this._mergeQuestionOf(error, name);
    if (question !== null) {
      this.merge.set(question);
      this._pane.set('merge');
      afterNextRender(() => this._mergeTitle()?.nativeElement.focus(), {
        injector: this._injector,
      });
      return;
    }

    this.merge.set(null);
    this._pane.set('settle');
    const key = basketErrorKey(error, 'basket.rename');
    this.renameErrorKey.set(key);
    this.renameErrorArgs.set(basketErrorArgs(error));
    this.renameReference.set(
      key === 'basket.error.failed' ? correlationIdOf(error) : null
    );
    this._keepFocusInside();
  }

  /**
   * One row per list the name is taken on, and one for the basket (section 4).
   *
   * The basket row says how many of the other line are still to get, read from the
   * line this basket holds. The refusal states that line's whole quantity, which is
   * the fallback for a line this reader has not been sent yet.
   */
  private _mergeQuestionOf(error: unknown, name: string): MergeQuestion | null {
    if (
      !(error instanceof GatewayError) ||
      error.code !== 'line_merge_required'
    ) {
      return null;
    }
    const required = toBasketMergeRequired(error.details);
    if (required === null) {
      return null;
    }

    const rows: MergeRow[] = required.lists.map((list) => ({
      key: `list:${list.listId}`,
      listName: list.listName,
      zoneName: list.zoneName,
      amountKey: 'basket.rename.mergeAsks',
      quantity: list.otherQuantity,
    }));
    if (required.basket !== null) {
      const { otherLineId, otherQuantity } = required.basket;
      const held = this._store.lines().find((row) => row.id === otherLineId);
      rows.push({
        key: 'basket',
        listName: null,
        zoneName: '',
        amountKey: 'basket.rename.mergeToGet',
        quantity: held === undefined ? otherQuantity : outstanding(held),
      });
    }
    return { name, rows };
  }

  /**
   * Whether to draw the list summary under the product (velista `0073`, section 3.3).
   *
   * The reader must hold an account and pass the all or nothing rule, which is
   * {@link canReadHistory}'s pair of conditions and for the same reason: the read
   * behind it names households, and the server refuses the whole of it to anybody
   * else rather than redacting it. A guest sees the sheet without the summary and
   * settles the whole line or part of it through the buttons as they do today.
   *
   * **Every line, added or derived, with lists or without.** Backend `0092` made
   * every list a row at zero, so a line somebody typed in an aisle is the one this
   * is most worth reading: three for the flat and two for their parents.
   *
   * A finished trip keeps it, unlike the control this replaced. The summary is
   * something the sheet **says** as well as a pair of controls, and a finished basket
   * is the receipt for a trip somebody took; the reels go and the numbers stay, which
   * is the treatment the row one screen up already gives a finished basket.
   */
  protected readonly canSeeLists = computed(
    () =>
      this._store.seesZoneData() &&
      this._store.me()?.kind !== 'GUEST' &&
      this.line() !== null
  );

  /** The basket line the summary is about, for its required input. */
  protected readonly lineId = this._lineIdParam;

  /**
   * The whole outstanding amount, in one tap. The common case.
   */
  protected async settleAll(): Promise<void> {
    await this._send({ outcome: 'BOUGHT' });
  }

  /** A number the person typed. Asks nothing about zones, so guests may use it. */
  protected async settleSome(): Promise<void> {
    await this._send({ outcome: 'BOUGHT', quantity: this.typed() });
  }

  /**
   * The shop did not have it.
   *
   * An outcome rather than a quantity: it closes the outstanding amount, and it
   * claims nothing was bought.
   */
  protected async settleNone(): Promise<void> {
    await this._send({ outcome: 'NOT_AVAILABLE' });
  }

  /**
   * Move units onto one product, or off it.
   *
   * Clamped **here** rather than trusted from the control. The reel bounds itself
   * at the ceiling the row hands it, but a write must hold whatever feeds it, and
   * this one is also driven directly. The floor is zero and the ceiling is the
   * balance plus this row's own value, which is the same rule
   * {@link productRows} draws.
   */
  protected setShare(itemId: string, quantity: number): void {
    this._shares.update((held) => {
      const own = held.get(itemId) ?? 0;
      const ceiling = this.balance() + own;
      const next = new Map(held);
      next.set(
        itemId,
        Math.max(0, Math.min(ceiling, Math.trunc(quantity) || 0))
      );
      return next;
    });
  }

  /**
   * The number under the thumb on a product's reel, written through as it moves.
   *
   * Two things hang on the write being live rather than waiting for the commit:
   * the balance above the rows walks down under the gesture, and an Apply pressed
   * inside the reel's idle beat sends the number on screen rather than the one
   * the last settled run left behind.
   */
  protected onSharePreview(itemId: string, next: number | null): void {
    if (next !== null) {
      this.setShare(itemId, next);
    }
  }

  /**
   * Commit the split: one write, on the button, and never per stepper move.
   *
   * Each tick of a stepper is a fragment of one decision, and creating a row per
   * tick would draw and fold rows while the thumb is still moving (section 2).
   *
   * The sheet dismisses on success, which is also what keeps section 3.1 simple:
   * this line may be the one the split folded away, and a sheet that stayed open
   * would be about a row that no longer exists. It goes either way, so there is
   * no case to tell apart.
   */
  protected async apply(): Promise<void> {
    const shares = [...this._shares()]
      .filter(([, quantity]) => quantity > 0)
      .map(([itemId, quantity]) => ({ itemId, quantity }));
    if (shares.length === 0) {
      return;
    }

    this._settling.set(true);
    this._failedOp.set(null);
    const result = await this._store.splitLine(this._lineId, {
      from: this._from(),
      shares,
    });
    this._settling.set(false);

    if (result === null) {
      this._failedOp.set('basket.split');
      // The store has already refetched on a stale `from`, so the pane reloads
      // its numbers rather than sitting on the ones it was refused for: the
      // sentence under the button names the amount as it now stands, exactly as
      // `0054` section 4.1 draws a stale reel.
      this._openProductPane();
      return;
    }

    this.close();
  }

  protected openPane(pane: Pane): void {
    this._failedOp.set(null);
    if (pane === 'history') {
      // Read on the way in rather than with the basket: most people settle a line and
      // never ask what happened to it, and this is one request per origin.
      void this._loadHistory();
    }
    if (pane === 'product') {
      this._openProductPane();
    }
    this._pane.set(pane);
  }

  /**
   * Take the pane's numbers from the line as it now stands: nothing moved, and
   * the whole outstanding amount as the balance.
   *
   * Called on the way in and again after a refused write, which is the same act:
   * the steppers a person set were refused, so leaving them there would invite
   * the same refusal.
   */
  private _openProductPane(): void {
    this._from.set(this.outstanding());
    this._shares.set(new Map());
  }

  /**
   * Cancel, Escape, the scrim, the back button, and a settle that landed cleanly.
   *
   * The basket's **whole** URL rather than a relative `..`, and that is the fix
   * rather than a preference. This sheet's path is three segments,
   * `lines/:lineId/settle`, and `..` climbs exactly one of them: closing left the
   * URL on `lines/:lineId`, which no route under the basket declares, so the
   * sheet dismissed onto the app's own 404. Every other sheet in the app already
   * names its page in full for the same reason (plan 0031).
   *
   * Through `SheetNavigation`, so this pops the entry the sheet was opened with
   * instead of pushing a second one: back from the basket goes on to whatever the
   * person was looking at before, and never reopens a spent sheet.
   */
  protected close(): void {
    // Marked before the navigation and not after, so the effect above cannot
    // dismiss a second time for a line that went away as this sheet was leaving.
    this._left = true;
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._generatedListId())
    );
  }

  /**
   * How many origins this act could not reach, phrased for whoever is reading.
   *
   * A reader who passes the rule gets the list names; everybody else gets the
   * count alone, which is section 6.4's report with the zone data taken out.
   *
   * **The count is always drawn, and the names are added to it** (plan 0049,
   * section 1.2). "2 lines could not be updated" is true for everybody and
   * unactionable on its own, so a reader entitled to the names is told which
   * list to go and look at; a guest keeps the sentence unchanged. The names
   * arrive **on the report**, composed by the gateway, so this screen still
   * reaches no zone list store and still cannot name a household it was not
   * handed one for.
   */
  protected readonly missed = computed<string | null>(() => {
    const result = this._result();
    if (result === null || result.skippedCount === 0) {
      return null;
    }

    const locale = this._locale();
    const count = this._translator.t(
      'basket.settle.missed',
      undefined,
      locale,
      {
        count: result.skippedCount,
      }
    );

    const named = this._missedNames();
    if (named === null) {
      return count;
    }

    return `${count} ${this._translator.t(
      'basket.settle.missedNamed',
      undefined,
      locale,
      { lists: named }
    )}`;
  });

  /**
   * The skipped lists as one phrase, or null when there is nothing to name.
   *
   * Null covers the two cases that must not be told apart in the copy: a reader
   * whose report has no `skipped` key at all, and an entitled report whose
   * entries have all lost their names to a deleted list. Both leave the bare
   * count, which is the honest half of the sentence.
   *
   * Deduplicated by name rather than by list id: two origins on one list are one
   * household to the person reading, and the report carries an entry per origin.
   */
  private readonly _missedNames = computed<string | null>(() => {
    const skipped = this._result()?.skipped ?? [];
    const names = new Set<string>();

    for (const entry of skipped) {
      if (entry.listName === null || entry.listName === '') {
        continue;
      }
      // The group is appended only where there is one, so a reader with two
      // lists called "Food" can tell them apart and everybody else is not made
      // to read a redundant word.
      names.add(
        entry.zoneName === null || entry.zoneName === ''
          ? entry.listName
          : `${entry.listName} (${entry.zoneName})`
      );
    }

    return names.size === 0 ? null : [...names].join(', ');
  });

  /**
   * What happened to this line, newest first, across every origin it was composed from.
   *
   * **One request per origin, and the answers merged.** The settlement route is keyed
   * on a *zone list line*, and a basket line is a sum of several: two flats both
   * wanting milk merge into one row here and contribute an origin each. Asking only the
   * first would draw one household's half of a shared line's history and give no sign
   * that the other half existed.
   *
   * `origins` is absent for a reader who does not pass the rule, which is the same
   * reader the control is not drawn for, so the empty list this produces for them is
   * belt and braces rather than the only guard.
   *
   * A failure of **any** origin fails the pane. This is a history, and a history
   * silently missing one shop's purchases is worse than one that says it could not
   * load: the whole reason to open it is to reconcile two people's trips.
   */
  private async _loadHistory(reset = true): Promise<void> {
    const origins = this.line()?.origins ?? [];
    if (origins.length === 0) {
      this._history.set([]);
      this._historyCursors.set(new Map());
      this._historyState.set('loaded');
      return;
    }

    // Which line to ask about, and from where. A reset asks each origin from the
    // beginning; `Show more` asks only the origins that still have a cursor.
    const asking = reset
      ? [...new Set(origins.map((origin) => origin.lineId))].map(
          (lineId) => [lineId, undefined] as const
        )
      : [...this._historyCursors()].map(
          ([lineId, cursor]) => [lineId, cursor] as const
        );

    if (asking.length === 0) {
      return;
    }

    this._historyState.set('loading');

    try {
      const pages = await Promise.all(
        asking.map(([lineId, cursor]) =>
          this._lines
            .listSettlements(lineId, cursor === undefined ? {} : { cursor })
            .then((page) => ({ lineId, page }))
        )
      );

      const cursors = new Map(reset ? [] : this._historyCursors());
      const rows = reset ? [] : [...this._history()];

      for (const { lineId, page } of pages) {
        if (page.nextCursor === null) {
          cursors.delete(lineId);
        } else {
          cursors.set(lineId, page.nextCursor);
        }
        rows.push(...page.items.map((row) => this._toRow(row)));
      }

      // Sorted after merging, not before: each origin answers newest first on its own,
      // and two origins interleaved by time is the order somebody actually shopped in.
      this._history.set(
        rows.sort((left, right) => right.at.getTime() - left.at.getTime())
      );
      this._historyCursors.set(cursors);
      this._historyState.set('loaded');
    } catch {
      // Including the 403 a participant gets on the request after losing `WRITE`.
      // The pane says it would not load rather than drawing a half history, and the
      // control itself disappears on the next basket read.
      this._historyState.set('failed');
    }
  }

  /** Ask each origin that still has a cursor for its next page. */
  protected retryHistory(): void {
    void this._loadHistory();
  }

  protected moreHistory(): void {
    void this._loadHistory(false);
  }

  /**
   * One settlement as a row, with its actor resolved against **the basket's people**.
   *
   * The same function the line page and the detail sheet use, which is why it lives in
   * `models` now: a history that read differently on two screens would cost the only
   * thing a history has. What differs is where a name comes from, and that is the
   * argument it takes: there it is the zone's members, here it is the participants, who
   * are the only people this screen has ever heard of.
   *
   * A settle made from a basket carries **no user id at all** when a guest made it
   * (backend `0051`), and the row draws the neutral phrase for that, which is right:
   * the person genuinely has no account to be named by.
   *
   * ## The reader's own row is named here, not in `toSettlementRow`
   *
   * `SettlementRowVm.who` is null for a `mine` row by construction, and the pane used
   * to draw `basket.history.you` for one. Plan 0052 section 2.1 names the reader
   * instead, for the reason the row caption does: this screen is read on other
   * people's phones.
   *
   * The **shared** function is deliberately left alone. It also serves the line page
   * and the line detail sheet (`libs/velista/models/src/lib/line-detail-view.ts`),
   * which are **zone** screens, where "You" is correct and is not part of this report.
   * So the override lives here, where the account and the locale already are.
   */
  private _toRow(settlement: {
    id: string;
    outcome: SettlementOutcome;
    quantity: number;
    settledByUserId: string | null;
    settledAt: Date;
  }): SettlementRowVm {
    const locale = this._locale();
    const byUserId = this._byUserId();

    const row = toSettlementRow(
      settlement,
      {
        nameOf: (userId) => {
          const person = byUserId.get(userId);
          return person === undefined
            ? null
            : participantName(person, this._translator, locale);
        },
        callerUserId: this._store.me()?.userId ?? null,
        locale,
      },
      null
    );

    if (!row.mine) {
      return row;
    }

    // A `mine` row means an account settled it and that account is the reader's, so
    // there is normally a username to use. Where there is not, `who` stays null and
    // the template falls back to "You" rather than to "Someone", which would be the
    // one wrong thing to call the person reading it.
    const own = this._session.username()?.trim();
    return own === undefined || own === '' ? row : { ...row, who: own };
  }

  /**
   * The basket's people by **account id**, for resolving a settlement's actor.
   *
   * Keyed on `userId` and not on the participant id, because those are different
   * identifiers and a settlement carries the account's. Guests are absent from this map
   * by construction, having no account, which is exactly the settle that arrives with a
   * null user id anyway.
   */
  private readonly _byUserId = computed(() => {
    const map = new Map<string, BasketParticipant>();
    for (const person of this._store.participants()) {
      if (person.userId !== null) {
        map.set(person.userId, person);
      }
    }
    return map;
  });

  private async _send(
    body: Parameters<BasketStore['settle']>[1]
  ): Promise<void> {
    this._settling.set(true);
    this._failedOp.set(null);
    const result = await this._store.settle(this._lineId, body);
    this._settling.set(false);

    if (result === null) {
      // Named rather than flagged, so the sentence can be the one the failure
      // actually deserves: a `conflict` here is somebody else finishing this line
      // between the sheet opening and the tap landing, which is the ordinary case
      // when two people work one list in a shop.
      this._failedOp.set('basket.settle');
      return;
    }

    this._result.set(result);
    if (result.skippedCount === 0) {
      // Nothing to report, so the sheet gets out of the way: the person is in a
      // shop and the next line is what they want to see.
      this.close();
    }
    // Otherwise it stays open showing what was missed, because a shopper who has
    // already bought the thing has to be told something did not land.
  }
}
