import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketStore,
  LINE_SERVICE,
  type LineServiceI,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  inLocale,
  outstanding,
  QUANTITY_REEL_PAGE_STEP,
  toSettlementRow,
  type BasketLine,
  type BasketParticipant,
  type BasketSettleResult,
  type SettlementOutcome,
  type SettlementRowVm,
} from '@portfolio/velista/models';
import {
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import { participantName } from '../basket-labels';
import { basketPath } from '../basket-paths';

/**
 * Which pane of the sheet is showing.
 *
 * One sheet with three panes rather than three sheets, because they are one
 * gesture at progressively more precision (section 4.2) and because a person in
 * an aisle should reach any of them in one tap from the row: three routes would
 * make the precise ones two taps and a navigation away from the number they were
 * about to type.
 */
type Pane = 'settle' | 'quantity' | 'product' | 'allocate' | 'history';

/** How the settlement history's read has got on. Four states, not two booleans. */
type HistoryLoad = 'idle' | 'loading' | 'loaded' | 'failed';

/**
 * How far each key moves the spinbutton, matching `QuantityReel`'s own table.
 *
 * The page step is **imported rather than repeated**, so the two controls cannot
 * drift into paging by different amounts: a person who learns the gesture on the
 * list page should find it does the same thing here.
 *
 * `Home` and `End` carry a step of zero because they are absolute rather than
 * relative; the handler reads the key for those two, and this map only says that
 * they are keys it handles at all.
 */
const STEP_FOR: Readonly<Record<string, number>> = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
  PageUp: QUANTITY_REEL_PAGE_STEP,
  PageDown: -QUANTITY_REEL_PAGE_STEP,
  Home: 0,
  End: 0,
};

/**
 * Settling one line: the whole amount, a number, or per household (plan 0044,
 * section 4.2).
 *
 * ## The two buttons, and why the first is one tap
 *
 * **Settle closes the whole outstanding amount** and is the common case, so it is
 * the largest control and takes one tap. **Partial submit asks for a number** and
 * is available to everybody, guests included, because it asks nothing about
 * zones. **Allocate** is the same act done precisely and is drawn only for a
 * reader who passes the all or nothing rule, because naming source lists is
 * naming zone data.
 *
 * A guest is never asked which household a tin of tomatoes belongs to. They are
 * in a shop with a list. The system allocates oldest origin first and the
 * allocation pane exists for the people who can see enough to correct it.
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
  imports: [RokuTranslatorPipe, SheetShell],
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

  /** The basket underneath, which is where closing this sheet goes. */
  private readonly _generatedListId = generatedListIdOf(this._route);

  private readonly _lineId = this._route.snapshot.paramMap.get('lineId') ?? '';
  private readonly _pane = signal<Pane>('settle');
  private readonly _busy = signal(false);
  private readonly _failed = signal(false);
  private readonly _result = signal<BasketSettleResult | null>(null);

  private readonly _history = signal<readonly SettlementRowVm[]>([]);
  private readonly _historyState = signal<HistoryLoad>('idle');
  /** The next cursor per origin line, so `Show more` knows what is left to ask. */
  private readonly _historyCursors = signal<ReadonlyMap<string, string>>(
    new Map()
  );

  protected readonly pane = this._pane.asReadonly();
  protected readonly busy = this._busy.asReadonly();
  protected readonly failed = this._failed.asReadonly();
  protected readonly result = this._result.asReadonly();
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

  protected readonly outstanding = computed(() => {
    const line = this.line();
    return line === null ? 0 : outstanding(line);
  });

  /**
   * What the stepper holds, for the partial submit.
   *
   * Starts at one rather than at the outstanding amount: somebody who wanted the
   * whole amount pressed the other button, so the number they are about to type
   * is by definition a smaller one.
   */
  protected readonly typed = signal(1);

  /** The picked product's name, for the line under the title. */
  protected readonly productName = computed<string | null>(() => {
    const pickId = this.line()?.pickId ?? null;
    const product =
      pickId === null ? undefined : this._store.basket()?.products.get(pickId);
    return product ? inLocale(product.name, this._locale()) : null;
  });

  /** Every product this line may be switched to, named, in the order given. */
  protected readonly options = computed(() => {
    const line = this.line();
    const products = this._store.basket()?.products;
    if (line === null || products === undefined) {
      return [];
    }
    return line.optionIds.flatMap((id) => {
      const product = products.get(id);
      // A product catalog no longer has is dropped rather than drawn as an id:
      // a basket outlives the catalog it was composed from.
      return product
        ? [
            {
              id,
              name: inLocale(product.name, this._locale()),
              brand: product.brand,
              chosen: id === line.pickId,
            },
          ]
        : [];
    });
  });

  /**
   * The allocation sheet's rows: one per source list, with what it wanted.
   *
   * Empty for a reader who does not pass the rule, which is also the reader for
   * whom the Allocate control is not drawn at all, so this is belt and braces
   * rather than the only guard.
   */
  protected readonly allocationRows = computed(() => {
    const origins = this.line()?.origins ?? [];
    const names = this._store.listNames();

    // **Grouped by list, not one row per origin.** Two lines in the same list
    // both wanting milk merge into one basket line and contribute an origin
    // each, so a straight map produces two rows with the same `listId`: two
    // duplicate `track` keys, and two fields overwriting each other in the
    // allocation map. The sheet asks which *household* gets how many, and a
    // household is a list, so the origins on one are summed.
    const byList = new Map<string, number>();
    for (const origin of origins) {
      byList.set(
        origin.listId,
        (byList.get(origin.listId) ?? 0) + origin.quantity
      );
    }

    return [...byList].map(([listId, wanted]) => ({
      listId,
      wanted,
      // Named where a name is known. A reader who reaches this pane passes the
      // rule, so `listNames` is populated for them by construction; the fallback
      // covers a list deleted since the run rather than a redacted one.
      name: names.get(listId) ?? null,
    }));
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

  /** What the person has put against each list, keyed by list id. */
  protected readonly allocation = signal<ReadonlyMap<string, number>>(
    new Map()
  );

  protected readonly allocated = computed(() =>
    [...this.allocation().values()].reduce((sum, n) => sum + n, 0)
  );

  /** The sheet's accessible title, which is the line's own words. */
  protected readonly title = computed(() => this.line()?.content ?? '');

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

  /** The same act with the allocation supplied instead of derived. */
  protected async settleAllocated(): Promise<void> {
    const allocations = [...this.allocation().entries()]
      .filter(([, quantity]) => quantity > 0)
      .map(([listId, quantity]) => ({ listId, quantity }));

    await this._send({
      outcome: 'BOUGHT',
      quantity: this.allocated(),
      allocations,
    });
  }

  /** Swap the pick. Anybody may, guests included: options are catalog data. */
  protected async choose(itemId: string): Promise<void> {
    this._busy.set(true);
    const changed = await this._store.setPick(this._lineId, itemId);
    this._busy.set(false);
    if (changed !== null) {
      this._pane.set('settle');
    }
  }

  protected openPane(pane: Pane): void {
    this._failed.set(false);
    if (pane === 'history') {
      // Read on the way in rather than with the basket: most people settle a line and
      // never ask what happened to it, and this is one request per origin.
      void this._loadHistory();
    }
    if (pane === 'allocate') {
      // Seeded from the default the server would have applied, so the sheet
      // opens on "what one tap would have done" and the person corrects it
      // rather than filling it in from nothing (section 4.2).
      this.allocation.set(this._defaultAllocation());
    }
    this._pane.set(pane);
  }

  protected setAllocation(listId: string, quantity: number): void {
    this.allocation.update((held) => {
      const next = new Map(held);
      next.set(listId, Math.max(0, quantity));
      return next;
    });
  }

  protected step(by: number): void {
    const max = this.outstanding();
    this.typed.update((n) => Math.min(Math.max(1, n + by), Math.max(1, max)));
  }

  /**
   * The keyboard half of the `spinbutton`, matching `QuantityReel`'s exactly.
   *
   * Plan 0044 section 7 asks for `0043`'s reel and spinbutton **unchanged**, and
   * the spinbutton half is what this is: the same keys, the same directions, the
   * same page step. The reel itself is deliberately not reused, because it is a
   * different question. It reports a signed **delta** on the line's own quantity
   * and is bounded by `LINE_QUANTITY_MIN..MAX`; this asks for an absolute number
   * of things bought, bounded by what is outstanding. Making the reel serve both
   * would have meant changing it, which is the one thing that section forbids.
   *
   * `ArrowUp` and `ArrowRight` increase, which is what the role requires and what
   * every native spinbutton does, however much the reel's own left-to-right drag
   * suggests otherwise.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const step = STEP_FOR[event.key];
    if (step === undefined) {
      return;
    }
    // The arrow keys scroll a sheet otherwise, which would move the control out
    // from under the person using it.
    event.preventDefault();

    if (event.key === 'Home') {
      this.typed.set(1);
      return;
    }
    if (event.key === 'End') {
      this.typed.set(Math.max(1, this.outstanding()));
      return;
    }
    this.step(step);
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

    return toSettlementRow(
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

  private _defaultAllocation(): ReadonlyMap<string, number> {
    // Oldest origin first until the outstanding amount is exhausted, which is
    // exactly what the server does when no allocation is supplied (backend
    // 0051, section 6.2). Reproducing it here is what makes the sheet a
    // correction rather than a blank form.
    let left = this.outstanding();
    const seeded = new Map<string, number>();
    for (const row of this.allocationRows()) {
      const take = Math.min(left, row.wanted);
      seeded.set(row.listId, take);
      left -= take;
    }
    return seeded;
  }

  private async _send(
    body: Parameters<BasketStore['settle']>[1]
  ): Promise<void> {
    this._busy.set(true);
    this._failed.set(false);
    const result = await this._store.settle(this._lineId, body);
    this._busy.set(false);

    if (result === null) {
      this._failed.set(true);
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
