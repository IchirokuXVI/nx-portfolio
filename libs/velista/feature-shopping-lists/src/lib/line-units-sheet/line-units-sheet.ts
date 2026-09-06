import { NgTemplateOutlet } from '@angular/common';
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
import { BasketStore, GatewayError } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  outstanding,
  type BasketLine,
  type BasketLineOriginDetail,
  type BasketListRef,
  type BasketOriginCandidate,
} from '@portfolio/velista/models';
import {
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { QuantityReel, SheetShell } from '@portfolio/velista/ui';
import { basketErrorKey } from '../basket-error-copy';
import { settleSheetPath } from '../basket-paths';

/** How the origins read has got on. Four states, not two booleans. */
type OriginsLoad = 'loading' | 'loaded' | 'failed';

/**
 * The bound the contribution field carries on the wire
 * (`SetGeneratedListOriginQuantityDto.quantity`).
 *
 * Stated here rather than reached for from the line's own limits, because it is a
 * different number for a different reason: `LINE_QUANTITY_MAX` is what a zone line may
 * ask for, and this is what one list may put into one basket line. A reel bounded above
 * what the server accepts is a control that can only produce a refusal.
 */
const ORIGIN_QUANTITY_MAX = 9999;

/** The floor of every reel here. Zero takes the list off the line (backend 0057, 5.3). */
const ORIGIN_QUANTITY_MIN = 0;

/**
 * What one row of this sheet says, whichever of the three collections it came from.
 *
 * One shape for all of them, because they are drawn identically and differ only in
 * what they start at, what the caption under the name says, and what raising one
 * does. Three view models would have made the template branch on which collection a
 * row came from, which is exactly the fact a reader is not supposed to have to hold.
 */
interface UnitsRow {
  /**
   * What identifies a row here.
   *
   * The zone line where there is one, because a list can hold two lines the run
   * merged into one basket line, so the list id does not identify a row and the
   * origin id does not exist yet for a candidate. A list holding no line at all has
   * no zone line to name, so it is keyed by the list, prefixed so the two spaces
   * cannot collide.
   */
  readonly key: string;
  readonly listId: string;
  /**
   * The zone line this row writes to, or null for a list holding none.
   *
   * Null is what makes the write a **creation** (backend `0092`, section 4.2): there
   * is nothing to name, so the request omits it and the server adds the line through
   * the ordinary add. It is not a missing value to be filled in.
   */
  readonly sourceLineId: string | null;
  /** The list's name, or the fallback phrase when the basket was told none. */
  readonly label: string;
  /**
   * The reel's accessible name, which is the list and the zone where the list alone
   * would name two of them (section 8).
   *
   * Somebody moving by control hears "Flat, 2" rather than "quantity, 2" five times,
   * which is the whole of what that section asks for.
   */
  readonly reelLabel: string;
  /**
   * The zone, drawn under the name **only** when another row shares that name.
   *
   * The same rule the skip report uses: a reader with one list called Food is not made
   * to read which house it is in, and a reader with two has no other way to tell.
   */
  readonly zoneName: string | null;
  /**
   * The zone this row is actually in, which is what the order is built on.
   *
   * Apart from {@link zoneName} because that one is a **display** value and is null
   * on most rows by design. Sorting on it would order two lists in one household by
   * whether a third list somewhere shares one of their names.
   */
  readonly zoneKey: string;
  /** Whether the run drew from this list, which is what sorts the rows first. */
  readonly fromRun: boolean;
  /** What this list asked for through this basket. Zero until somebody raises it. */
  readonly contributed: number;
  /** What the zone line asks for now, which is a different number the moment either moves. */
  readonly listQuantity: number;
  /** What this basket has already bought for this list, which is the floor. */
  readonly settledHere: number;
  /**
   * The caption under the name about the list's own line, as a key, or null.
   *
   * Three different sentences from three different places, resolved here so the
   * template draws one span: what a list that has not been raised asks for on its
   * own, what a raised list's line asks for now when the two have drifted, and
   * nothing at all for a list that holds no such line.
   */
  readonly listCaption: RowCaption | null;
  /** Whether the zone line is still waiting for its list to agree (section 4.2). */
  readonly pending: boolean;
  /** That list's own wording of the line, for a candidate matched on text alone. */
  readonly matchedOnText: string | null;
  /**
   * Why this row has no reel, as a translation key, or null when it may be moved.
   *
   * `0030` says a control you may not use is not drawn, and this is the other half of
   * that: the **information** is a fact about a list this reader is entitled to, so it
   * stays, and the row says in words why nothing can be done with it.
   */
  readonly reason: string | null;
  /**
   * What the last write on this row came to, if it said anything. Empty otherwise.
   *
   * A list rather than one sentence, because a write that lands can have two things
   * to say: that a list received units bought before it was on the line, and that
   * there are units left over which a second list would take (section 6).
   */
  readonly notices: readonly RowNotice[];
  /** What the reel should show, which is the floor after a refusal and the contribution otherwise. */
  readonly shown: number;
}

/** One sentence on one row, with whatever it names. */
interface RowCaption {
  readonly key: string;
  /** Interpolation for the key, empty where it takes none. */
  readonly values: Readonly<Record<string, string | number>>;
}

/** A sentence about what a write did, which a standing caption is not. */
interface RowNotice extends RowCaption {
  /**
   * Whether this is a refusal or a thing that happened.
   *
   * Section 6 puts the write's own news in **the slot** a refusal uses, and a slot is
   * not a colour: "Added to Flat. 4 recorded as bought there" drawn in the refusal's
   * red would read as a failure to somebody who had just succeeded.
   */
  readonly tone: 'refusal' | 'news';
}

/**
 * What a row that cannot be raised says, keyed on the server's reason.
 *
 * Two entries where `0055` had three, and the third is gone rather than renamed:
 * backend `0092` section 3.2 made a pending line and a line at zero adoptable, so
 * `NOT_APPROVED` and `SETTLED` are no longer answered and no longer drawn. Anything
 * this build cannot read arrives as `UNAVAILABLE` from the mapper and says only that.
 */
const UNAVAILABLE_KEY: Readonly<Record<string, string>> = {
  CLAIMED: 'basket.units.claimed',
  REJECTED: 'basket.units.rejected',
  UNAVAILABLE: 'basket.units.cannotTake',
};

/**
 * What every list asked for, on one sheet (velista `0068`, widening `0055`).
 *
 * A basket line of three litres of milk is the flat wanting two and the parents'
 * house wanting one, and somebody who added batteries in an aisle wanting three for
 * the flat and two for their parents. This is the sheet that shows that split, for
 * **every** list the reader can write, and lets them move each number.
 *
 * ## One sheet, because it is one question and one write
 *
 * There were two. The units sheet showed what each list asked for, but only lists
 * already holding the line; the send sheet offered every list, but once, to an added
 * line, and only as a name to tap. Backend `0092` made both one write, so a list with
 * no such line is a row at zero exactly like the others, and raising it from zero is
 * what "send this line to that list" now means.
 *
 * ## Nothing on this sheet buys anything
 *
 * The single thing to keep right, because the identical control one screen up means the
 * opposite. On the row a reel dragged down records a purchase (`0054`); here it is a
 * household changing its mind, and backend `0057` section 1 writes no settlement, sets
 * no bought indicator and emits no `line.settled` for it.
 *
 * The screen says so three ways. A permanent sentence under the title, in words. No
 * caption while the thumb is down, where the row's reel narrates "2 bought", so the
 * gesture that reports a purchase and the gesture that does not are told apart by
 * whether they narrate one. And the copy on every row is about **asking for** rather
 * than about getting: the **Asked for** column never moves on a purchase, and the
 * **Bought** column never moves from this sheet.
 *
 * ## One write per row, on release, and never a save button
 *
 * A sheet that collected five numbers and applied them together would have to explain a
 * partial failure. Applying them one at a time means the row that failed is the row that
 * says so, which is section 5 and is why every failure here lands on a row rather than
 * on the sheet.
 *
 * ## A row raised stays where it is
 *
 * The three collections are the **read's** partition and nothing rewrites them, so a
 * list raised from the closed run becomes an origin and keeps its place rather than
 * jumping to the top of the sheet under somebody's thumb. What the answer changes is
 * the row's numbers, held in {@link _written} beside the read, and the next read is
 * what re-groups.
 *
 * ## What `from` is, and what it is not
 *
 * Every write carries the contribution this client last **read**, never a number that
 * happens to be on screen. The reel reports where its own gesture started, which is the
 * same number until a refusal moves the displayed value to the floor, and sending that
 * would turn one refusal into a silent overwrite of somebody else's arithmetic.
 */
@Component({
  selector: 'lib-line-units-sheet',
  imports: [NgTemplateOutlet, RokuTranslatorPipe, QuantityReel, SheetShell],
  templateUrl: './line-units-sheet.html',
  styleUrl: './line-units-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineUnitsSheet {
  private readonly _store = inject(BasketStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The bounds every reel on this sheet carries, stated once for the template. */
  protected readonly reelMin = ORIGIN_QUANTITY_MIN;
  protected readonly reelMax = ORIGIN_QUANTITY_MAX;

  /** The basket underneath, which is what the settle sheet's URL is built from. */
  private readonly _generatedListId = generatedListIdOf(this._route);
  private readonly _lineId = this._route.snapshot.paramMap.get('lineId') ?? '';

  private readonly _state = signal<OriginsLoad>('loading');
  private readonly _origins = signal<readonly BasketLineOriginDetail[]>([]);
  private readonly _candidates = signal<readonly BasketOriginCandidate[]>([]);
  private readonly _others = signal<readonly BasketListRef[]>([]);

  /**
   * What each row's write last answered, by row key.
   *
   * Beside the three collections rather than folded into them, which is what keeps a
   * raised row in its place: the grouping is the read's and this is the numbers'. A
   * fresh read clears it, because the read is the authority on both.
   */
  private readonly _written = signal<
    ReadonlyMap<string, BasketLineOriginDetail>
  >(new Map());

  /** Whether the lists that asked for nothing are showing. Closed by default (4.3). */
  private readonly _restOpen = signal(false);

  /**
   * What each open reel is currently under the thumb, by row.
   *
   * The total at the top is what the reader is actually deciding, so it has to move
   * while a thumb is down (section 4.1) and the committed numbers cannot answer that.
   * A row leaves this map the moment its overlay closes, which is also the moment its
   * write goes out.
   */
  private readonly _previews = signal<ReadonlyMap<string, number>>(new Map());

  /** The rows with a write in flight, which is what makes their reel readonly. */
  private readonly _busy = signal<ReadonlySet<string>>(new Set());

  /** The last thing each row's write had to say, in the row's own words. */
  private readonly _notices = signal<ReadonlyMap<string, readonly RowNotice[]>>(
    new Map()
  );

  /**
   * Rows whose write was refused with `forbidden`, which loses them their reel.
   *
   * Held here rather than folded into the origin, because it is this session's own
   * observation and not something the read said: the next reload answers `writable`
   * for itself, and the two must not be able to disagree in the direction that draws a
   * control the server refuses.
   */
  private readonly _forbidden = signal<ReadonlySet<string>>(new Set());

  /**
   * Where a reel should sit after a refused lower, by row.
   *
   * Section 5: a contribution refused for going under what has already been bought
   * returns to the floor rather than to where it started, because the floor is where
   * the reader was heading. The **next** `from` is still the real contribution, which
   * is why this is a display value and lives apart from the origin.
   */
  private readonly _floors = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly state = this._state.asReadonly();
  protected readonly restOpen = this._restOpen.asReadonly();
  protected readonly busy = this._busy.asReadonly();

  /** The line this sheet is about, read live so a write updates it under us. */
  protected readonly line = computed<BasketLine | null>(
    () => this._store.lines().find((row) => row.id === this._lineId) ?? null
  );

  /** The sheet's accessible title, which is the line's own words. */
  protected readonly title = computed(() => this.line()?.content ?? '');

  /**
   * The lists sharing a name, so only those rows are made to name their zone.
   *
   * All three collections together, because the ambiguity a reader suffers is on the
   * screen and not in one collection: a list called Food that asked and a second
   * called Food that could be asked are two rows with one name however they arrived.
   */
  private readonly _ambiguous = computed<ReadonlySet<string>>(() => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    const names = [
      ...this._origins().map((origin) => origin.listName),
      ...this._candidates().map((candidate) => candidate.listName),
      ...this._others().map((other) => other.listName),
    ];

    for (const name of names) {
      if (name === null || name === '') {
        continue;
      }
      if (seen.has(name)) {
        twice.add(name);
      }
      seen.add(name);
    }

    return twice;
  });

  /**
   * The lists that asked for some of this, one row each (section 4.2).
   *
   * An origin at zero is not one of them: it asked for nothing, which is the same
   * answer as a list that never did, so it sits with them behind the control below.
   */
  protected readonly asked = computed<readonly UnitsRow[]>(() =>
    this._originRows()
      .filter((row) => row.contributed > 0)
      .sort(byRunThenName)
  );

  /**
   * The lists that asked for nothing, in the order section 4.3 states.
   *
   * Two runs with no heading between them, because they are one answer to the reader
   * ("these lists are not asking for any of this") and two different writes: the
   * first holds a line this raise would take over, and the second has none and gets
   * one made.
   */
  protected readonly rest = computed<readonly UnitsRow[]>(() => [
    ...this._originRows()
      .filter((row) => row.contributed === 0)
      .sort(byRunThenName),
    ...[...this._candidateRows()].sort(byRunThenName),
    ...[...this._otherRows()].sort(byRunThenName),
  ]);

  /** Whether the read came back with nothing at all to show. */
  protected readonly empty = computed(
    () => this.asked().length === 0 && this.rest().length === 0
  );

  /**
   * How far every open reel is from the number behind it, summed.
   *
   * The one thing that makes the total move under a thumb. A row with no overlay open
   * contributes nothing, so this is zero whenever nobody is touching anything.
   */
  private readonly _pendingDelta = computed(() => {
    const previews = this._previews();
    if (previews.size === 0) {
      return 0;
    }

    let delta = 0;
    for (const row of [...this.asked(), ...this.rest()]) {
      const preview = previews.get(row.key);
      if (preview !== undefined) {
        delta += preview - row.contributed;
      }
    }
    return delta;
  });

  /**
   * What this basket will buy, live (section 4.1).
   *
   * The outstanding amount, which is the number a shopper is deciding, plus wherever
   * the open reels currently are. It is at the **top** rather than under the rows so it
   * stays visible while a thumb is on a reel at the bottom of the sheet.
   */
  protected readonly total = computed(() => {
    const line = this.line();
    return Math.max(
      0,
      (line === null ? 0 : outstanding(line)) + this._pendingDelta()
    );
  });

  /** What the lists between them are asking for, live. */
  protected readonly listsWant = computed(
    () => this._contributed() + this._pendingDelta()
  );

  /**
   * How much of the line nobody asked for, which `0054` allows and backend `0057`
   * section 5.1 preserves across every write here.
   *
   * Constant while a thumb is down, and correctly so: raising a contribution raises the
   * basket line by the same amount, so the difference between the two does not move.
   * Without this second sentence the arithmetic on the screen does not add up and reads
   * as a defect.
   */
  protected readonly extra = computed(() => {
    const line = this.line();
    return line === null ? 0 : Math.max(0, line.quantity - this._contributed());
  });

  /** What the rows say the lists asked for, as the last read and write left them. */
  private readonly _contributed = computed(() =>
    this._originRows().reduce((sum, row) => sum + row.contributed, 0)
  );

  constructor() {
    void this._read(true);
  }

  /** Ask again after a failed read. The only thing the failed state offers. */
  protected retry(): void {
    void this._read(true);
  }

  protected toggleRest(): void {
    this._restOpen.update((open) => !open);
  }

  /**
   * A reel moved under a thumb, or its overlay closed.
   *
   * Null means closed, which is also the moment {@link commit} runs, so the total goes
   * from following the thumb to following the line without a frame in between where it
   * counts the same units twice.
   */
  protected onPreview(row: UnitsRow, value: number | null): void {
    this._previews.update((held) => {
      const next = new Map(held);
      if (value === null) {
        next.delete(row.key);
      } else {
        next.set(row.key, value);
      }
      return next;
    });
  }

  /**
   * One row's number, set (section 5).
   *
   * `from` is {@link UnitsRow.contributed} and never the reel's own starting number.
   * They are the same until a refusal moves the displayed value to the floor, and after
   * one the reel's number is a suggestion while the contribution is still what the
   * server last told us. Sending the suggestion would turn a refusal into an overwrite.
   *
   * The zone line is **omitted** for a list holding none, which is the whole of what
   * makes this the same call as sending a line somewhere: the server creates the line
   * and answers the id it landed on, which is not always the one a fresh add would
   * have made (backend `0092`, section 4.2).
   */
  protected async commit(
    row: UnitsRow,
    change: { from: number; to: number }
  ): Promise<void> {
    if (row.reason !== null || change.to === row.contributed) {
      return;
    }

    this._clear(row.key);
    this._setBusy(row.key, true);

    const result = await this._store.setOriginQuantity(this._lineId, {
      listId: row.listId,
      ...(row.sourceLineId === null ? {} : { lineId: row.sourceLineId }),
      quantity: change.to,
      from: row.contributed,
    });

    this._setBusy(row.key, false);

    if (result === null) {
      await this._report(row);
      return;
    }

    if (result.origin === null) {
      // Zero drops the origin (backend 0057, section 5.3), and the list goes back to
      // asking for nothing. Re-read rather than move the row by hand: whether it can
      // be raised again is a question about claims and approvals that only the server
      // can answer.
      await this._read(false);
      return;
    }

    this._record(row, result.origin, result.line);
  }

  /**
   * Cancel, Escape, the scrim and the back gesture, all onto the settle sheet.
   *
   * This sheet is opened **over** that one, so back has to land there rather than on the
   * basket (`0031`). The whole URL and never a relative climb, for the reason every
   * sheet here names its page in full: the number of segments in somebody else's path is
   * not something this component's correctness may depend on.
   */
  protected close(): void {
    void this._sheet.dismiss(
      settleSheetPath(
        this._locale(),
        this._basePath,
        this._generatedListId(),
        this._lineId
      )
    );
  }

  /**
   * Read every list this reader may write.
   *
   * `first` is what decides whether a failure takes the screen. The opening read has
   * nothing to keep, so it fails to a sentence and a retry; a re-read after a write has
   * rows on screen that are still true, and replacing them with a spinner would take
   * away the numbers somebody is in the middle of correcting.
   */
  private async _read(first: boolean): Promise<void> {
    if (first) {
      this._state.set('loading');
    }

    const answer = await this._store.loadLineOrigins(this._lineId);

    if (answer === null) {
      if (first) {
        this._state.set('failed');
      }
      return;
    }

    this._origins.set(answer.origins);
    this._candidates.set(answer.candidates);
    this._others.set(answer.others);
    // A fresh read is the server's own answer about the numbers, about access and
    // about floors, so this session's observations of all three go with it rather
    // than outliving what produced them.
    this._written.set(new Map());
    this._forbidden.set(new Set());
    this._floors.set(new Map());
    this._state.set('loaded');
  }

  /**
   * Take what a write answered, and say what it did that the numbers do not.
   *
   * The row keeps its place: what changes is the numbers behind it. The two sentences
   * this draws are section 6's, and both are drawn from the answer rather than
   * inferred, because "the flat now knows about batteries and needs none" is a strange
   * enough outcome that it has to be said in words the moment it happens.
   *
   * Both are said **only on the answer that put this list on the line**. A later edit
   * of a row that has always been bought against is not news, and repeating "some are
   * still waiting" on every drag would turn a fact into wallpaper.
   */
  private _record(
    row: UnitsRow,
    origin: BasketLineOriginDetail,
    line: BasketLine
  ): void {
    this._written.update((held) => new Map(held).set(row.key, origin));

    if (row.contributed > 0) {
      return;
    }

    const said: RowNotice[] = [];

    // Units bought before this list was on the line, re-homed onto it by the write
    // that put it there (backend `0093`, section 3).
    if (origin.settledHere > 0) {
      said.push({
        key: 'basket.units.cameHome',
        values: { name: row.label, count: origin.settledHere },
        tone: 'news',
      });
    }

    // And what those purchases could not fill, because this list asked for fewer than
    // were waiting. Said so the shopper knows a second list would take the rest,
    // rather than leaving them to work it out from two numbers on two screens.
    if (line.waitingSettled > 0) {
      said.push({
        key: 'basket.units.stillWaiting',
        values: { count: line.waitingSettled },
        tone: 'news',
      });
    }

    if (said.length > 0) {
      this._notices.update((held) => new Map(held).set(row.key, said));
    }
  }

  /**
   * Say what went wrong, on the row it went wrong on, with the sheet still open.
   *
   * Each of these leaves the reader somewhere different: a number somebody else moved
   * first, a raise that landed on a list already holding this line, a number under
   * what has already been bought, access that has gone since the sheet opened, and a
   * list whose own answer about this line changed underneath the read.
   */
  private async _report(row: UnitsRow): Promise<void> {
    const error = this._store.error();
    const key = basketErrorKey(error, 'basket.origins');
    const code = error instanceof GatewayError ? error.code : null;

    if (code === 'forbidden') {
      // The row keeps its numbers and loses its control, in place. They are still facts
      // about a list this reader is entitled to; what has gone is the ability to write.
      this._forbidden.update((held) => new Set(held).add(row.key));
      return;
    }

    if (code === 'below_settled') {
      this._floors.update((held) =>
        new Map(held).set(row.key, row.settledHere)
      );
      this._notice(row.key, key, { count: row.settledHere });
      return;
    }

    if (code === 'stale_quantity') {
      // The store has already refetched the basket, which is the line. The lists are a
      // second read and this is where it happens, so the sentence can name the number
      // this list is actually at rather than saying only that something failed.
      await this._read(false);
      if (row.sourceLineId === null) {
        // A raise on a list this read said held no such line, refused because it does
        // (backend `0092`, section 4.2). Nothing moved underneath the reader's
        // arithmetic, so the sentence is about the list rather than about a number.
        this._notice(row.key, 'basket.units.alreadyHere', {});
        return;
      }
      this._notice(row.key, key, { count: this._contributionOf(row.key) });
      return;
    }

    if (code === 'validation_failed') {
      // The list's own answer about this line moved: it was rejected, or another
      // basket claimed it, between the read and the release. Both are refusals the
      // read reports as a reason, so the honest sentence is whatever the row says
      // about itself once it has been read again, rather than a guess at which.
      await this._read(false);
      this._notice(row.key, this._reasonOf(row.key) ?? key, {});
      return;
    }

    this._notice(row.key, key, {});
  }

  /** What the fresh read says this row asked for, zero if it no longer asks. */
  private _contributionOf(key: string): number {
    return this._originRows().find((row) => row.key === key)?.contributed ?? 0;
  }

  /** Why the fresh read says this row cannot be raised, or null if it can. */
  private _reasonOf(key: string): string | null {
    return (
      [...this.asked(), ...this.rest()].find((row) => row.key === key)
        ?.reason ?? null
    );
  }

  private _notice(
    key: string,
    messageKey: string,
    values: Readonly<Record<string, string | number>>
  ): void {
    this._notices.update((held) =>
      new Map(held).set(key, [{ key: messageKey, values, tone: 'refusal' }])
    );
  }

  /** Drop whatever the last attempt on this row left behind, before the next one. */
  private _clear(key: string): void {
    this._notices.update((held) => {
      const next = new Map(held);
      next.delete(key);
      return next;
    });
    this._floors.update((held) => {
      const next = new Map(held);
      next.delete(key);
      return next;
    });
  }

  private _setBusy(key: string, busy: boolean): void {
    this._busy.update((held) => {
      const next = new Set(held);
      if (busy) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  /** The lists already on the line, whatever they now ask for. */
  private readonly _originRows = computed<readonly UnitsRow[]>(() =>
    this._origins().map((origin) => {
      const now = this._written().get(origin.lineId) ?? origin;
      return this._row({
        key: origin.lineId,
        listId: now.listId,
        sourceLineId: now.lineId,
        listName: now.listName,
        zoneName: now.zoneName,
        fromRun: now.fromRun,
        contributed: now.contributed,
        listQuantity: now.listQuantity,
        settledHere: now.settledHere,
        pending: now.approvalStatus === 'PENDING',
        matchedOnText: null,
        // What the list's own line asks for now, when it has drifted from what it
        // asked for here minus what has been bought against it. The basket is a
        // snapshot and this is the one screen where the snapshot and the live list
        // are both in front of somebody.
        listCaption:
          now.listQuantity === now.contributed - now.settledHere
            ? null
            : {
                key: 'basket.units.listNow',
                values: { count: now.listQuantity },
              },
        // `writable` is the server's answer about the **owner's** access, which is
        // what authorizes every write made from this basket. A row it says no to
        // keeps its numbers and loses its control.
        reason: now.writable ? null : 'basket.units.noAccess',
      });
    })
  );

  /** The lists holding the same thing that have not been raised yet. */
  private readonly _candidateRows = computed<readonly UnitsRow[]>(() =>
    this._candidates().map((candidate) => {
      const now = this._written().get(candidate.lineId);
      return this._row({
        key: candidate.lineId,
        listId: candidate.listId,
        sourceLineId: candidate.lineId,
        listName: candidate.listName,
        zoneName: candidate.zoneName,
        fromRun: candidate.fromRun,
        // Nothing yet, which is what makes moving one off zero an adoption: it takes
        // over the demand the list already has before it adds any (backend `0092`,
        // section 4.1), so raising it to what it asks for moves that list by nothing.
        contributed: now?.contributed ?? 0,
        listQuantity: now?.listQuantity ?? candidate.listQuantity,
        settledHere: now?.settledHere ?? 0,
        pending: now?.approvalStatus === 'PENDING',
        // Drawn distinctly on purpose (backend 0057, section 8): the run merges on
        // normalized text as its last resort, so a match made that way is one the
        // reader should confirm rather than one the run would have been sure of.
        matchedOnText: candidate.matchedOnText ? candidate.content : null,
        listCaption:
          now === undefined
            ? {
                key: 'basket.units.listAsks',
                values: { count: candidate.listQuantity },
              }
            : null,
        reason:
          candidate.unavailable === null
            ? null
            : (UNAVAILABLE_KEY[candidate.unavailable] ?? null),
      });
    })
  );

  /** The lists holding no such line, which raising creates one on. */
  private readonly _otherRows = computed<readonly UnitsRow[]>(() =>
    this._others().map((other) => {
      const key = `list:${other.listId}`;
      const now = this._written().get(key);
      return this._row({
        key,
        listId: other.listId,
        // Null until a write answers one, and null is what makes the write a
        // creation rather than an adoption. A row that has been raised keeps the
        // line the server answered, which is not always a new one.
        sourceLineId: now?.lineId ?? null,
        listName: now?.listName ?? other.listName,
        zoneName: now?.zoneName ?? other.zoneName,
        fromRun: other.fromRun,
        contributed: now?.contributed ?? 0,
        listQuantity: now?.listQuantity ?? 0,
        settledHere: now?.settledHere ?? 0,
        pending: now?.approvalStatus === 'PENDING',
        matchedOnText: null,
        // Nothing to say: the list asks for none of this and holds no line to have
        // an opinion about it.
        listCaption: null,
        reason: null,
      });
    })
  );

  /** One row, from whichever collection it came out of. */
  private _row(
    source: Pick<
      UnitsRow,
      | 'key'
      | 'listId'
      | 'sourceLineId'
      | 'fromRun'
      | 'contributed'
      | 'listQuantity'
      | 'settledHere'
      | 'pending'
      | 'matchedOnText'
      | 'listCaption'
      | 'reason'
    > & {
      readonly listName: string | null;
      readonly zoneName: string | null;
    }
  ): UnitsRow {
    const named = source.listName !== null && source.listName !== '';
    // Named where a name is known. A reader who reaches this sheet passes the all or
    // nothing rule, so the names are theirs by construction; the fallback covers a list
    // deleted since rather than a redacted one.
    const label = named
      ? (source.listName as string)
      : this._translator.t('basket.unnamed', undefined, this._locale());
    const zoneName =
      named && this._ambiguous().has(source.listName as string)
        ? source.zoneName
        : null;

    return {
      key: source.key,
      listId: source.listId,
      sourceLineId: source.sourceLineId,
      label,
      reelLabel:
        zoneName === null || zoneName === '' ? label : `${label} (${zoneName})`,
      zoneName,
      zoneKey: source.zoneName ?? '',
      fromRun: source.fromRun,
      contributed: source.contributed,
      listQuantity: source.listQuantity,
      settledHere: source.settledHere,
      listCaption: source.listCaption,
      pending: source.pending,
      matchedOnText: source.matchedOnText,
      reason: this._forbidden().has(source.key)
        ? 'basket.units.noAccess'
        : source.reason,
      notices: this._notices().get(source.key) ?? [],
      shown: this._floors().get(source.key) ?? source.contributed,
    };
  }
}

/**
 * The run's own lists first, then by zone and by list name (section 4.2).
 *
 * The server sorts nothing and says so (backend `0092`, section 3), because the order
 * is a fact about the person reading rather than about the data: somebody adding bread
 * in an aisle almost always means one of the lists the basket came from.
 *
 * By zone before list, so two lists in one household stay together, and by the
 * reader's own locale, so accented names fall where a Spanish speaker expects.
 */
function byRunThenName(left: UnitsRow, right: UnitsRow): number {
  if (left.fromRun !== right.fromRun) {
    return left.fromRun ? -1 : 1;
  }
  const zone = left.zoneKey.localeCompare(right.zoneKey);
  return zone === 0 ? left.label.localeCompare(right.label) : zone;
}
