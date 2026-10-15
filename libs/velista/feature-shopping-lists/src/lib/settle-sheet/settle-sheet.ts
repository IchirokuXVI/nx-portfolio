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
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  BasketViewStore,
  GatewayError,
  LINE_SERVICE,
  SessionStore,
  toBasketMergeRequired,
  type LineServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  basketRowProduct,
  catalogName,
  LINE_CONTENT_MAX_LENGTH,
  shownOffer,
  toSettlementRow,
  type BasketParticipant,
  type BasketProduct,
  type BasketProductList,
  type BasketRow as BasketRowModel,
  type BasketRowResult,
  type SettlementOutcome,
  type SettlementRowVm,
} from '@portfolio/velista/models';
import {
  formatMoney,
  rowKeyOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { CheckIcon, SheetShell, SpinnerIcon } from '@portfolio/velista/ui';
import {
  basketErrorArgs,
  basketErrorKey,
  correlationIdOf,
  type BasketOperation,
} from '../basket-error-copy';
import {
  basketRowName,
  participantName,
  touchedCaption,
} from '../basket-labels';
import { basketPath, settleSheetPath, shopAskPath } from '../basket-paths';
import {
  changeableLineIds,
  changeSheetPath,
} from '../change-sheet/change-targets';
import { HeldBuy } from '../held-buy';
import { RowEntries, type OtherListsState } from '../row-entries/row-entries';

/**
 * Which pane of the sheet is showing.
 *
 * One sheet with panes rather than several sheets, because a person in an aisle
 * should reach any of them in one tap from the row. The pane that asked which
 * product was got is gone (velista `0139`, section 3): a row is one product, so
 * there is nothing to ask.
 */
type Pane = 'settle' | 'history' | 'merge';

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
 * One line of the basket: its product, what each household asked for and got, and
 * the ways to close it without buying (plan 0044, section 4.2).
 *
 * ## No "Got all" and no "Got some"
 *
 * The sheet had both, and they are gone. Buying the whole row is the row's own
 * control on the basket page, and buying part of it is the "got" reel below. Both
 * reels commit on release and **leave the sheet open**, because somebody moving
 * a number wants to see where it landed.
 *
 * ## What every list asked for and got, under the product (velista `0073`)
 *
 * There were two more controls here and they are both gone. **Allocate** was a pane
 * saying who got how many of what was just bought; **Change what each list asked
 * for** opened a second sheet saying who wanted how many. They were the same rows
 * drawn twice, in two places nobody found.
 *
 * What replaced them is `RowEntries`, drawn under the product entry for a
 * reader who passes the all or nothing rule: one row per list, both numbers, both
 * controls.
 *
 * ## Not available is here, and it is not a quantity
 *
 * It closes the outstanding amount without claiming anything was bought, and it
 * closes the sheet with it.
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
 * The served list refs are the server's answer on the most recent basket read, so a
 * participant who loses `WRITE` loses the control on the next one, and the request
 * behind it is refused by the gateway regardless of what is on screen.
 */
@Component({
  selector: 'lib-settle-sheet',
  imports: [CheckIcon, RowEntries, RokuTranslatorPipe, SheetShell, SpinnerIcon],
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
  private readonly _router = inject(Router);
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

  /**
   * The basket underneath, which is where closing this sheet goes and what its
   * own re-keyed URL is built from.
   *
   * From the **store** and not from `paramMap` since velista `0091`: the same
   * page is routed at `shopping-lists/live`, where there is no id in the URL at
   * all, and a sheet that read one there would dismiss to `/shopping-lists/`.
   */
  private readonly _address = this._store.address;

  /**
   * The row, as a signal and not a snapshot (velista `0090`, section 7.3).
   *
   * A row's key is its **anchor's** line id, and the anchor moves: somebody adds an
   * earlier line of the same name on another list, a rename merges two rows, the
   * anchor is bought to zero and deleted. The sheet holds the key from its URL and
   * asks the store on every change, which is the third answer `rowFor` exists for.
   */
  private readonly _rowKeyParam = rowKeyOf(this._route);
  private get _rowKey(): string {
    return this._rowKeyParam();
  }

  /**
   * What the screen is pricing at (velista `0078`), so the options on the product
   * pane are quoted at the shop the row underneath is quoted at.
   *
   * A sheet may inject a store (rule D1), and this is the second one it injects:
   * the page's own filter decided this, and a pane that read the cheapest price
   * anywhere while the row above it read Mercadona's would be two numbers for one
   * product on one screen.
   */
  private readonly _view = inject(BasketViewStore);
  /** The buy that waits for the shop question, which the page provides (`0141`). */
  private readonly _held = inject(HeldBuy);

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
  private readonly _result = signal<BasketRowResult | null>(null);

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
  protected readonly history = this._history.asReadonly();
  protected readonly historyState = this._historyState.asReadonly();
  protected readonly historyHasMore = computed(
    () => this._historyCursors().size > 0
  );

  /**
   * The row this sheet is about, read live so a write updates it under us.
   *
   * Found by its key, then by any entry's line id, which is
   * {@link BasketStore.rowFor}'s whole point: a row whose anchor changed is the same
   * row under a new key, and a sheet that could not find it would dismiss itself
   * over nothing.
   */
  protected readonly row = computed<BasketRowModel | null>(() =>
    this._store.rowFor(this._rowKey)
  );

  /**
   * Whether this sheet has already left, so it leaves exactly once.
   *
   * A field and not a signal: nothing draws it, and an effect that wrote a signal
   * it also reads would be a loop.
   */
  private _left = false;

  constructor() {
    // A sheet whose row was **re-keyed** follows it, in place (velista `0090`,
    // section 7.3).
    //
    // The row is the same thing under a new key, so the sheet replaces its own URL
    // and says nothing: its pane stays, its typed values stay, and focus stays where
    // it was. A dismissal here would close a sheet over a row that is still there,
    // which is what happens to anybody standing at a shelf while somebody else adds
    // the same thing on another list.
    effect(() => {
      const row = this.row();
      if (row === null || this._left || this._following()) {
        return;
      }
      const key = this._rowKey;
      if (row.rowKey === key) {
        return;
      }
      untracked(() => void this._followRowKey(row.rowKey));
    });

    // A sheet about a row that is **gone** dismisses itself (velista `0069`,
    // section 3.1; `0031`). A back gesture would land on it, and its controls would
    // send writes for a key the server no longer holds.
    effect(() => {
      // Only once the basket has actually been read. Before that every row is
      // absent, and dismissing then would close the sheet somebody deep linked to
      // before it ever drew.
      //
      // Nor while a rename is out or following a new key: a merge that absorbs this
      // row takes it out of the store before the answer reaches this sheet.
      if (
        this._left ||
        this.saving() ||
        this._following() ||
        this._store.state() !== 'ready' ||
        this.row() !== null
      ) {
        return;
      }
      this._left = true;
      this._store.sayRowGone();
      this.close();
    });
  }

  /**
   * Take this sheet's URL to the row's new key, without a history entry.
   *
   * `leaveTo` replaces rather than pushes, which is what this needs and why it is
   * the right call here: nothing happened that a back gesture should undo, and a
   * pushed entry would put a dead key in the history for a back gesture to land on.
   */
  private async _followRowKey(rowKey: string): Promise<void> {
    this._following.set(true);
    await this._sheet.leaveTo(
      settleSheetPath(this._locale(), this._basePath, this._address(), rowKey)
    );
    this._following.set(false);
  }

  /** What this row still asks for, read and never computed. */
  protected readonly outstanding = computed(() => this.row()?.left ?? 0);

  /**
   * Whether this row has nothing left to settle (plan 0052, section 7.1).
   *
   * A finished row is still tappable, deliberately: `0043` section 3.2 keeps it in
   * place so somebody can look at what they bought. So this sheet opens on one, and
   * every settle target on it would be a control that could not work: the server
   * refuses a settle on a row with nothing outstanding.
   *
   * **A control you may not use is not drawn** (`0030`), so this is what the settle
   * pane branches its targets on rather than a disabled state.
   */
  protected readonly finished = computed(
    () => this.row() !== null && this.outstanding() === 0
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
   * What happened to this row, in one sentence, for a finished one.
   *
   * The **same** sentence `touchedCaption` composes for the row underneath, so the
   * sheet and the row cannot disagree about what a person did. Null for a row nobody
   * has touched, which a finished row never is, and for one that was renamed rather
   * than settled.
   */
  protected readonly whatHappened = computed<string | null>(() => {
    const row = this.row();
    return row === null
      ? null
      : touchedCaption(
          row,
          this._store.participantsById(),
          this._translator,
          this._locale(),
          this._store.me()?.id ?? null,
          this._session.username()
        );
  });

  /**
   * Whether somebody bought this row outside this shopping list (velista `0142`,
   * section 1).
   *
   * Its sheet is the lists that ask, each with its quantity, **and nothing else**:
   * no button buys, skips or takes back, because this shopping list bought none
   * of it and the server refuses to undo a buy of another. A list can still ask
   * for the product again from its quantity, where `demandEditable` allows it.
   */
  protected readonly boughtElsewhere = computed(
    () => this.row()?.state === 'BOUGHT_ELSEWHERE'
  );

  /**
   * The row's product, or null for a row whose lines hold none (backend `0201`).
   */
  private readonly _product = computed<BasketProduct | null>(() => {
    const row = this.row();
    return row === null ? null : basketRowProduct(row, this._store.products());
  });

  /**
   * Under the title: the price of one, and how many are left to get (velista
   * `0139`, section 3). "0.92 € each · 6 to get". The price is the one the row
   * underneath draws, at the chosen shop when the rows are priced there, so the
   * sheet cannot quote a number the row does not. A finished row says what
   * happened instead of "0 to get".
   */
  protected readonly subtitle = computed<string | null>(() => {
    const row = this.row();
    if (row === null) {
      return null;
    }
    const locale = this._locale();
    const offer = shownOffer(this._product(), this._view.pricedAtShop());
    const parts = [
      offer === null
        ? null
        : this._translator.t('basket.sheet.each', undefined, locale, {
            price: formatMoney(offer.price, offer.currency, locale),
          }),
      this.finished()
        ? null
        : this._translator.t('basket.sheet.toGet', undefined, locale, {
            count: row.left,
          }),
    ].filter((part): part is string => part !== null);
    return parts.length === 0 ? null : parts.join(' · ');
  });

  /**
   * What this basket got of these lines, in one quiet line (velista `0139`,
   * section 3): how many, at what price, and where. Null when it got none.
   *
   * The price and the shop are the ones the row draws now: a settle records the
   * price shown at the shop it names, so they are what the buy recorded unless
   * the shop or its price moved since. The history pane holds the record itself.
   */
  protected readonly gotToday = computed<string | null>(() => {
    const row = this.row();
    if (row === null || row.bought === 0) {
      return null;
    }
    const locale = this._locale();
    const offer = shownOffer(this._product(), this._view.pricedAtShop());
    const chosen = this._view.pricedAtShop() ? this._view.chosenShop() : null;
    const where =
      chosen === null
        ? null
        : chosen.shop === null
          ? chosen.chain
          : `${chosen.chain}, ${chosen.shop}`;
    const price =
      offer === null ? null : formatMoney(offer.price, offer.currency, locale);
    const key =
      price === null
        ? 'basket.sheet.got'
        : where === null
          ? 'basket.sheet.gotAt'
          : 'basket.sheet.gotAtShop';
    return this._translator.t(key, undefined, locale, {
      count: row.bought,
      price: price ?? '',
      shop: where ?? '',
    });
  });

  /**
   * The primary button: "Got all 6", or "Got the other 4" once some of it is
   * bought (velista `0139`, section 3).
   */
  protected readonly gotAllLabel = computed(() => {
    const row = this.row();
    return this._translator.t(
      row !== null && row.bought > 0
        ? 'basket.sheet.gotOther'
        : 'basket.sheet.gotAll',
      undefined,
      this._locale(),
      { count: row?.left ?? 0 }
    );
  });

  /**
   * The lists that could take the product, or null when "Add it to another list"
   * is not drawn (velista `0139`, section 3): a guest, a row with no product, a
   * finished trip, a reader served no list.
   *
   * Read once for the product when the sheet opens, not when the disclosure
   * does: the disclosure is not drawn when the read answers no list, and only a
   * read can say so. A failure is drawn inside it, with a retry.
   */
  protected readonly others = computed<OtherListsState | null>(() => {
    const row = this.row();
    if (
      row === null ||
      row.productId === null ||
      this.boughtElsewhere() ||
      this.basketFinished() ||
      this._store.me()?.kind === 'GUEST' ||
      this.lists().size === 0
    ) {
      return null;
    }
    const read = this._others();
    if (read === null || read.itemId !== row.productId) {
      return { state: 'loading' };
    }
    if (read.state.state !== 'ready') {
      return read.state;
    }
    // The server decides the lists with no picks, so a list whose line counts
    // as this product only by its price comes back too. The row already draws
    // it, and it is left out here (backend `0201`, "What the build decided",
    // point 14).
    const drawn = new Set(row.entries.map((entry) => entry.listId));
    return {
      state: 'ready',
      lists: read.state.lists.filter((list) => !drawn.has(list.listId)),
    };
  });

  /** The read of {@link others}, and the product it was for. */
  private readonly _others = signal<{
    readonly itemId: string;
    readonly state: OtherListsState;
  } | null>(null);

  private readonly _readOthers = effect(() => {
    const row = this.row();
    const itemId = row?.productId ?? null;
    const eligible =
      itemId !== null &&
      !this.basketFinished() &&
      this._store.me() !== null &&
      this._store.me()?.kind !== 'GUEST' &&
      this.lists().size > 0;
    if (!eligible || itemId === null) {
      return;
    }
    untracked(() => {
      if (this._others()?.itemId !== itemId) {
        void this._loadOthers(itemId);
      }
    });
  });

  private async _loadOthers(itemId: string): Promise<void> {
    this._others.set({ itemId, state: { state: 'loading' } });
    const lists = await this._store.productLists(itemId);
    if (this._others()?.itemId !== itemId) {
      return;
    }
    this._others.set({
      itemId,
      state: lists === null ? { state: 'failed' } : { state: 'ready', lists },
    });
  }

  /**
   * The lines Change is drawn on (velista `0140`, section 1): those the reader
   * may edit, on lists they were served, of a row with a product that is not
   * crossed out. None for a guest or once the trip is over.
   */
  protected readonly changeable = computed<ReadonlySet<string>>(() => {
    const row = this.row();
    return new Set(
      row === null
        ? []
        : changeableLineIds(row, {
            guest: this._store.me()?.kind === 'GUEST',
            finished: this.basketFinished(),
            lists: this.lists(),
          })
    );
  });

  /** Change on one list: the change sheet, pushed over this one. */
  protected changeLine(lineId: string): void {
    this._openChange(lineId);
  }

  /** "Change for all lists". */
  protected changeAll(): void {
    this._openChange(null);
  }

  private _openChange(lineId: string | null): void {
    const row = this.row();
    if (row === null) {
      return;
    }
    void this._router.navigateByUrl(
      changeSheetPath(
        this._locale(),
        this._basePath,
        this._address(),
        row.rowKey,
        lineId
      )
    );
  }

  /** The read failed and the reader asked again. */
  protected retryOthers(): void {
    const itemId = this.row()?.productId ?? null;
    if (itemId !== null) {
      void this._loadOthers(itemId);
    }
  }

  /**
   * A list that did not ask was given a quantity (velista `0139`, section 3).
   *
   * A list that holds the product at zero raises its line through the demand
   * route (backend `0201`, "What the build decided", point 2). A list that does
   * not hold it gets a line named by the product, with that one product. Either
   * way the list then joins the lists that ask, and it leaves this read.
   */
  protected async raise(change: {
    readonly list: BasketProductList;
    readonly to: number;
  }): Promise<void> {
    const product = this._product();
    const row = this.row();
    if (product === null || row === null || this.busy()) {
      return;
    }
    const { list, to } = change;

    this._settling.set(true);
    this._failedOp.set(null);
    const result =
      list.lineId === null
        ? await this._store.addLine({
            targetListId: list.listId,
            content: catalogName(product.name, this._locale()),
            quantity: to,
            itemIds: [product.id],
            // Made from the product, so not named (velista `0144`).
            named: false,
          })
        : await this._store.setDemand({
            lineId: list.lineId,
            quantity: to,
            from: list.quantity ?? 0,
          });
    this._settling.set(false);

    if (result === null) {
      this._failedOp.set(
        list.lineId === null ? 'basket.addLine' : 'basket.demand'
      );
      return;
    }

    const read = this._others();
    if (read !== null && read.state.state === 'ready') {
      this._others.set({
        itemId: read.itemId,
        state: {
          state: 'ready',
          lists: read.state.lists.filter((held) => held.listId !== list.listId),
        },
      });
    }
  }

  /**
   * Buy everything the lines still ask for, which is the primary button. The same
   * body the row's own glyph sends, with the row's product (velista `0139`,
   * section 4), so the two gestures cannot record different things.
   */
  protected async settleAll(): Promise<void> {
    const left = this.outstanding();
    const got = this._got();
    await this._buy(() => ({
      outcome: 'BOUGHT',
      quantity: left,
      from: left,
      ...got(),
    }));
  }

  /**
   * Whether this reader may read what happened to the line (plan 0049, section 1.1).
   *
   * Two conditions, and they are two because they are two different facts. The reader
   * must hold an **account**, since the settlement route authenticates one and a guest
   * has none to present; and the row must have at least one entry on a list they were
   * **served**, because that is the list whose settlements the route reads. The owner
   * satisfies both by owning the basket.
   *
   * A control you may not use is not drawn (`0030`), so this decides whether the way
   * into the pane exists at all rather than whether it is disabled. Losing `WRITE`
   * takes the list's ref off the next basket read and the control goes with it,
   * which is the per request check working rather than a second copy of it.
   */
  protected readonly canReadHistory = computed(() => {
    const row = this.row();
    return (
      row !== null &&
      !this.boughtElsewhere() &&
      this._store.me()?.kind !== 'GUEST' &&
      row.entries.some((entry) => entry.listId !== null)
    );
  });

  /**
   * The sheet's title: the product on a row of one, the line's own words on a
   * row with none, from the function the row underneath draws its name with.
   */
  protected readonly title = computed(() => {
    const row = this.row();
    return row === null
      ? ''
      : basketRowName(
          row,
          this._store.products(),
          this._translator,
          this._locale()
        );
  });

  // --- Renaming the row (velista `0084`) -------------------------------------

  /**
   * Whether to draw the name field in place of the title (section 2).
   *
   * An account, and **every entry's list served**, which is the client half of the
   * server's rule: backend `0113` lets somebody rename exactly the rows whose every
   * list they can write, and a list this reader was not served is one they cannot.
   * A guest never, because a guest is served no list at all. Nobody once the trip is
   * finished, like every other control here.
   *
   * It replaced a `seesZoneData` read, which was one flag for the whole basket: a
   * reader who could write four of five covered lists was refused the field on every
   * row, including the four rows they could rename. The question is per row now
   * because the data is.
   *
   * This only decides whether the field is drawn. The server asks again on the save,
   * and its refusal is what the sheet then shows.
   */
  protected readonly canRename = computed(() => {
    const row = this.row();
    const me = this._store.me();
    if (row === null || me === null || this.basketFinished()) {
      return false;
    }
    if (me.kind === 'GUEST' || this.boughtElsewhere()) {
      return false;
    }
    // A row with a product is named by the catalog, and the server refuses a
    // rename of a line that holds any product (backend `0201`, point 16).
    return (
      row.productId === null &&
      row.entries.every(
        (entry) => entry.listId !== null && entry.itemIds.length === 0
      )
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
    const row = this.row();
    const typed = this.name().trim();
    return (
      this.canRename() &&
      row !== null &&
      typed !== '' &&
      typed !== row.content &&
      !this.busy()
    );
  });

  /**
   * Fills the field from the line, and follows the line while the reader has not
   * typed. Not while a save is out: the store applies the answer before the sheet
   * reads it, and the sheet fills the field from that answer itself.
   */
  private readonly _seedName = effect(() => {
    const content = this.row()?.content;
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
    const rowKey = this._rowKey;
    const content = (this.merge()?.name ?? this.name()).trim();

    this.saving.set(true);
    this._failedOp.set(null);
    this.renameErrorKey.set(null);
    this.renameErrorArgs.set({});
    this.renameReference.set(null);

    const result = await this._store.renameRow(
      rowKey,
      confirmMerge ? { content, confirmMerge: true } : { content }
    );
    this.saving.set(false);

    if (result === null) {
      this._refused(this._store.error(), content);
      return;
    }

    // The answer is the renamed lines (backend `0201`): their words are the new
    // name. A merge into another row is drawn by the read that follows every
    // write, and this sheet follows its row to whatever key it then has.
    const renamed = result.entries[0]?.content ?? content;
    this.merge.set(null);
    this._pane.set('settle');
    this.saved.set(true);
    this.name.set(renamed);
    this._shown = renamed;

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
      const { otherRowKey, otherQuantity } = required.basket;
      const held = this._store.rowFor(otherRowKey);
      rows.push({
        key: 'basket',
        listName: null,
        zoneName: '',
        amountKey: 'basket.rename.mergeToGet',
        // What that row still asks for, read off it where this basket holds it and
        // taken from the refusal where it does not: the refusal states the other
        // line's whole quantity, which is the honest answer when there is no row.
        quantity: held === null ? otherQuantity : held.left,
      });
    }
    return { name, rows };
  }

  /** The lists this reader was served, for the name on each entry. */
  protected readonly lists = this._store.lists;

  /**
   * The product this settle names, as a body fragment to spread (velista `0092`,
   * section 5).
   *
   * **Omitted rather than sent undefined**, which is the rule the gateway follows
   * too: the server validates `itemId` as one of the row's own options, so a key
   * present and empty is a refusal where an absent one is "nobody said which".
   *
   * Spread into every `BOUGHT` here and nowhere else decided, because the rule is
   * `BasketStore.itemIdFor`'s: a choice that is still one of this row's options,
   * or a row with exactly one option and therefore nothing to choose between.
   *
   * Two products on one row are **two settles**, which is the shape this replaced
   * the split with: "Got some, 2" with the whole milk chosen, then "Got it" with
   * the skimmed. Each settlement names one product, and the purchase history ends
   * up truer than a split ever made it.
   *
   * It also names the price scope of the offer the row underneath draws for that
   * product (velista `0095`, section 6), and never an amount: the gateway reads the
   * price itself. Absent when the row draws no price. And, while a shop is chosen,
   * that shop (velista `0102`), from the one place the row's settle asks too.
   */
  private _got(): () => {
    itemId?: string;
    priceScopeId?: string;
    supermarketLocationId?: string;
  } {
    // The row's product now, and the shop when the body is built: a buy held by
    // the shop question (velista `0141`) is built after the answer chose it.
    const itemId = this.row()?.productId ?? null;
    const product = this._product();
    return () => ({
      ...(itemId === null ? {} : { itemId }),
      ...this._view.settleShop(product),
    });
  }

  /**
   * Not today (velista `0092`, section 3.1).
   *
   * **A state of the row on this trip, and no list moves.** It is not an outcome
   * of a settle and never will be: `SETTLEMENT_OUTCOMES` has no `SKIPPED` member
   * on purpose, because a settlement is a record of what was bought and this
   * records that nothing was.
   *
   * Every participant may, a guest included: it is a smaller act than a settle,
   * which every participant already may.
   */
  protected async skip(): Promise<void> {
    await this._run(() => this._store.skip(this._rowKey));
  }

  /**
   * Back on the list, which is the same fact unset.
   *
   * Two buttons and never one toggle (section 11). A toggle is a control whose
   * meaning depends on a state somebody has to read first, and these are pressed
   * in an aisle at arm's length.
   *
   * It leads the pane on a skipped row, and the three buying actions stay under
   * it: a person who skipped the bread and then found it buys it, and the server
   * ends the skip with the purchase rather than asking for this first.
   */
  protected async unskip(): Promise<void> {
    await this._run(() => this._store.unskip(this._rowKey));
  }

  /**
   * Whether "Not today" is offered.
   *
   * A row that still has something to get, on a basket that is still open. A row
   * the shop had none of is already closed for today, and one bought out has
   * nothing to walk past; the server refuses both, and a control it refuses is
   * not drawn (`0030`).
   */
  protected readonly canSkip = computed(() => {
    const state = this.row()?.state;
    return !this.basketFinished() && (state === 'WANTED' || state === 'PARTLY');
  });

  /** Whether this row is put off for now, which leads the pane with its undo. */
  protected readonly isSkipped = computed(
    () => !this.basketFinished() && this.row()?.state === 'SKIPPED'
  );

  /**
   * The shop did not have it.
   *
   * An outcome rather than a quantity: it closes the row and claims nothing was
   * bought. It carries `from` like every other write on a row.
   */
  protected async settleNone(): Promise<void> {
    // **No `itemId`**, and that is not an omission: a close buys nothing, so
    // there is no product to record against it. Naming one would put a product
    // in a purchase history that has no purchase in it.
    // The shop, though: "they had none" is a fact about the shop the person is
    // standing in, and every settle made while one is chosen names it (velista
    // `0102`). In "any of your shops" mode it names none.
    const from = this.outstanding();
    await this._buy(() => {
      const shop = this._view.shop();
      return {
        outcome: 'NOT_AVAILABLE',
        from,
        ...(shop === null ? {} : { supermarketLocationId: shop }),
      };
    });
  }

  /**
   * What one list asks for was changed (velista `0092`, section 6).
   *
   * Not `_send`'s path, and the difference is the whole of section 6: every other
   * write on this sheet records what a trip did, and this one rewrites a
   * household's list for everybody. So it has its own failures, its own sentence
   * and its own ending.
   *
   * Three endings:
   *
   * - the row came back, and the sheet **stays open** on it, as it does for the
   *   "got" reel beside it: the reel commits on release with no confirmation,
   *   and the person moving it wants to see where it landed;
   * - the row is **gone**, which is a demand taken to zero on a row nothing was
   *   bought of. The list now asks for nothing, which is what was asked for, so
   *   the page is handed a sentence and the sheet closes over a row that is no
   *   longer there;
   * - it was refused, and the store has already read the basket again. The
   *   sentence is then about the row as it now stands.
   */
  protected async demand(change: {
    lineId: string;
    from: number;
    to: number;
  }): Promise<void> {
    // The name the sheet is titled with, taken before the row can leave.
    const name = this.title();

    this._settling.set(true);
    this._failedOp.set(null);
    const result = await this._store.setDemand({
      lineId: change.lineId,
      quantity: change.to,
      from: change.from,
    });
    this._settling.set(false);

    if (result === null) {
      // `stale_quantity` and `forbidden` each get their own sentence, keyed on
      // the operation as well as the code: a refused demand is the owner's
      // standing having moved between the read and the tap, which is a different
      // fact from a refused settle.
      this._failedOp.set('basket.demand');
      return;
    }

    if (
      this._store.lineLeft(result, change.lineId) &&
      this._store.rowFor(this._rowKey) === null
    ) {
      // The sentence is the **page's** to say, because this sheet is about to
      // stop existing: its row left the basket, and one live region per screen
      // is the rule (velista `0054`, section 7).
      this._store.handOver(
        this._translator.t(
          'basket.demand.nothingLeft',
          undefined,
          this._locale(),
          {
            name,
          }
        )
      );
      this.close();
    }
  }

  protected openPane(pane: Pane): void {
    this._failedOp.set(null);
    if (pane === 'history') {
      // Read on the way in rather than with the basket: most people settle a row and
      // never ask what happened to it, and this is one request per entry.
      void this._loadHistory();
    }
    this._pane.set(pane);
  }

  /**
   * Cancel, Escape, the scrim, the back button, and a settle that landed cleanly.
   *
   * The basket's **whole** URL rather than a relative `..`, and that is the fix
   * rather than a preference. This sheet's path is three segments,
   * `rows/:rowKey/settle`, and `..` climbs exactly one of them: closing left the
   * URL on `rows/:rowKey`, which no route under the basket declares, so the
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
      basketPath(this._locale(), this._basePath, this._address())
    );
  }

  /**
   * How many entries a **revert** could not reach, or null (backend `0136`).
   *
   * The names are gone with the rule that produced them. A settle used to skip an
   * origin whose access had gone, and the gateway composed a named report for a
   * reader entitled to it; coverage is recomputed on every request now, so there is
   * no `ACCESS_GONE` skip left to report (backend `0130`, section 5). What can still
   * be skipped is an entry whose **line was deleted** since the purchase, which has
   * no units to put back, and that is a count and not a household: naming it would
   * name a list that is not there.
   *
   * So the sentence is the count alone, which was already the half every reader got.
   */
  protected readonly missed = computed<string | null>(() => {
    const result = this._result();
    if (result === null || result.skippedCount === 0) {
      return null;
    }

    return this._translator.t(
      'basket.settle.missed',
      undefined,
      this._locale(),
      { count: result.skippedCount }
    );
  });

  /**
   * What happened to this row, newest first, across every entry it groups.
   *
   * **One request per entry, and the answers merged.** The settlement route is keyed
   * on a *list line*, and a row is a group of several: two flats both wanting milk are
   * one row here and one entry each. Asking only the first would draw one household's
   * half of a shared row's history and give no sign
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
    // The **served** entries, which is what the route can answer for: it reads a
    // zone list line as an account, so a list this reader was not served is one
    // they hold no `WRITE` on and the request would be refused.
    const entries = (this.row()?.entries ?? []).filter(
      (entry) => entry.listId !== null
    );
    if (entries.length === 0) {
      this._history.set([]);
      this._historyCursors.set(new Map());
      this._historyState.set('loaded');
      return;
    }

    // Which line to ask about, and from where. A reset asks each origin from the
    // beginning; `Show more` asks only the origins that still have a cursor.
    const asking = reset
      ? [...new Set(entries.map((entry) => entry.lineId))].map(
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

  /**
   * Send a settle, or hold it and ask where the person is first (velista `0141`).
   *
   * The body is built when it is sent, because the shop in it is what the
   * question decides. A held buy outlives this sheet, which the question replaces,
   * so it reaches nothing of the sheet's: a failure is the page's to show, as it is
   * for the row's own circle.
   */
  private async _buy(
    body: () => Parameters<BasketStore['settle']>[1]
  ): Promise<void> {
    if (!this._view.asksForShop()) {
      await this._run(() => this._store.settle(this._rowKey, body()));
      return;
    }

    const rowKey = this._rowKey;
    const store = this._store;
    this._held.hold(async () => {
      await store.settle(rowKey, body());
    });
    // Marked first, so the effect that closes this sheet for a row gone cannot
    // dismiss it a second time on the way out.
    this._left = true;
    await this._sheet.leaveTo(
      shopAskPath(this._locale(), this._basePath, this._address())
    );
  }

  /**
   * One write on this row, with the busy state and the failure reporting around it.
   *
   * Shared by the settle targets, the entries pane and the revert, because all of
   * them do the same three things: mark the sheet busy, fold or report, and get out
   * of the way when there is nothing to say.
   *
   * `stayOpen` is the entries pane's reels, which keep the sheet up after a write
   * that landed. The buttons close it.
   */
  private async _run(
    send: () => Promise<BasketRowResult | null>,
    { stayOpen = false }: { readonly stayOpen?: boolean } = {}
  ): Promise<void> {
    this._settling.set(true);
    this._failedOp.set(null);
    const result = await send();
    this._settling.set(false);

    if (result === null) {
      // Named rather than flagged, so the sentence can be the one the failure
      // actually deserves: a `conflict` here is somebody else finishing this row
      // between the sheet opening and the tap landing, which is the ordinary case
      // when two people work one list in a shop.
      this._failedOp.set('basket.settle');
      return;
    }

    this._result.set(result);
    if (result.skippedCount === 0 && !stayOpen) {
      // Nothing to report, so the sheet gets out of the way: the person is in a
      // shop and the next row is what they want to see.
      this.close();
    }
    // Otherwise it stays open showing what was missed, because a shopper who has
    // already bought the thing has to be told something did not land.
  }
}
