import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore, GatewayError } from '@portfolio/velista/data-access';
import {
  type BasketLine,
  type BasketLineOriginDetail,
  type BasketListRef,
  type BasketOriginCandidate,
} from '@portfolio/velista/models';
import { QuantityReel } from '@portfolio/velista/ui';
import { basketErrorKey } from '../basket-error-copy';

/** How the origins read has got on. Three states, not two booleans. */
type OriginsLoad = 'loading' | 'loaded' | 'failed';

/**
 * The bound the two contribution fields carry on the wire
 * (`SetGeneratedListOriginQuantityDto.quantity`).
 *
 * Stated here rather than reached for from the line's own limits, because it is a
 * different number for a different reason: `LINE_QUANTITY_MAX` is what a zone line
 * may ask for, and this is what one list may put into one basket line. A reel
 * bounded above what the server accepts is a control that can only produce a
 * refusal.
 */
const ORIGIN_QUANTITY_MAX = 9999;

/**
 * What one row of the summary says, whichever of the three collections it came from.
 *
 * One shape for all of them, because they are drawn identically and differ only in
 * what they start at, what the caption under the name says, and what raising one
 * does. Three view models would have made the template branch on which collection a
 * row came from, which is exactly the fact a reader is not supposed to have to hold.
 */
interface SummaryRow {
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
   * Null is what makes the asked for write a **creation** (backend `0092`, section
   * 4.2): there is nothing to name, so the request omits it and the server adds the
   * line through the ordinary add. It is also what makes the row's second reel
   * impossible: a list holding no line of this cannot have got any of it.
   */
  readonly sourceLineId: string | null;
  /** The list's name, or the fallback phrase when the basket was told none. */
  readonly label: string;
  /**
   * The name the asked for reel announces (section 7).
   *
   * Two reels on one row need two names that differ **before** the number, so
   * somebody moving by control hears "Flat, asked for, 4" and then "Flat, got, 2"
   * rather than the same word twice.
   */
  readonly askedLabel: string;
  /** The name the got reel announces. See {@link askedLabel}. */
  readonly gotLabel: string;
  /**
   * The zone, drawn under the name **only** when another row shares that name.
   *
   * The same rule the skip report uses: a reader with one list called Food is not
   * made to read which house it is in, and a reader with two has no other way to
   * tell.
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
  readonly asked: number;
  /** What this basket has bought for this list, which is the row's second number. */
  readonly got: number;
  /** What the zone line asks for now, a different number the moment either moves. */
  readonly listQuantity: number;
  /**
   * The caption under the name about the list's own line, as a key, or null.
   *
   * Three different sentences from three different places, resolved here so the
   * template draws one span: what a list that has not been raised asks for on its
   * own, what a raised list's line asks for now when the two have drifted, and
   * nothing at all for a list that holds no such line.
   */
  readonly listCaption: RowCaption | null;
  /** Whether the zone line is still waiting for its list to agree (backend `0092`). */
  readonly pending: boolean;
  /** That list's own wording of the line, for a candidate matched on text alone. */
  readonly matchedOnText: string | null;
  /**
   * Why this row has no controls, as a translation key, or null when it may move.
   *
   * `0030` says a control you may not use is not drawn, and this is the other half
   * of that: the **information** is a fact about a list this reader is entitled to,
   * so it stays, and the row says in words why nothing can be done with it.
   */
  readonly reason: string | null;
  /**
   * What the last write on this row came to, if it said anything. Empty otherwise.
   *
   * A list rather than one sentence, because a write that lands can have two things
   * to say: that a list received units bought before it was on the line, and that
   * there are units left over which a second list would take.
   */
  readonly notices: readonly RowNotice[];
  /** What the asked for reel shows: the floor after a refusal, the number otherwise. */
  readonly shownAsked: number;
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
   * A write's own news goes in **the slot** a refusal uses, and a slot is not a
   * colour: "Added to Flat. 4 recorded as bought there" drawn in the refusal's red
   * would read as a failure to somebody who had just succeeded.
   */
  readonly tone: 'refusal' | 'news';
}

/**
 * What a row that cannot be raised says, keyed on the server's reason.
 *
 * Two entries where `0055` had three, and the third is gone rather than renamed:
 * backend `0092` section 3.2 made a pending line and a line at zero adoptable, so
 * `NOT_APPROVED` and `SETTLED` are no longer answered and no longer drawn. Anything
 * this build cannot read arrives as `UNAVAILABLE` from the mapper and says only
 * that.
 */
const UNAVAILABLE_KEY: Readonly<Record<string, string>> = {
  CLAIMED: 'basket.units.claimed',
  REJECTED: 'basket.units.rejected',
  UNAVAILABLE: 'basket.units.cannotTake',
};

/**
 * What every list asked for and what every list got, under the product on the settle
 * sheet (velista `0073`, section 3).
 *
 * ## Why it is a component and not more of `SettleSheet`
 *
 * The plan puts these rows on the settle sheet, and this is them: the sheet draws
 * one element under its product entry. Keeping the read, the two writes and the row
 * model behind that element is what makes section 3.4 true by construction rather
 * than by care — **the settle buttons never wait for this** — because a read that
 * belongs to a child cannot hold up a parent's template. It also keeps the sheet's
 * own file readable, which five panes had already stretched.
 *
 * ## Two reels on one row, and they are opposite acts
 *
 * **Asked for** is what that list wants through this basket. It writes
 * `BasketStore.setOriginQuantity`, floored at what that list has already got and
 * bounded by what the wire accepts, and it buys nothing whichever way it goes.
 *
 * **Got** is what this basket has bought for that list. It writes
 * `BasketStore.setOriginSettled` (backend `0104`, section 4), floored at zero and
 * capped at what that list asked for. Raising it takes the line's outstanding number
 * down by the same amount and is the same purchase the row's number one screen up
 * writes; lowering it takes a purchase back for that list alone.
 *
 * This replaced two controls that said the same thing in two places: the allocate
 * pane, which said who got how many of what was just bought, and the units sheet,
 * which said who wanted how many. They were the same rows drawn twice.
 *
 * ## One write per reel, on release, and never a save button
 *
 * A sheet that collected ten numbers and applied them together would have to explain
 * a partial failure. Applying them one at a time means the row that failed is the
 * row that says so, which is why every failure here lands on a row rather than on
 * the sheet.
 *
 * ## A row raised stays where it is
 *
 * The three collections are the **read's** partition and nothing rewrites them, so a
 * list raised from the closed section becomes an origin and keeps its place rather
 * than jumping to the top under somebody's thumb. What an answer changes is the
 * row's numbers, held in {@link _written} beside the read, and the next read is what
 * re-groups.
 *
 * ## What `from` is, and what it is not
 *
 * Every write carries the number this client last **read**, never a number that
 * happens to be on screen. A reel reports where its own gesture started, which is
 * the same number until a refusal moves the displayed value to the floor, and
 * sending that would turn one refusal into a silent overwrite of somebody else's
 * arithmetic.
 */
@Component({
  selector: 'lib-line-lists-summary',
  imports: [NgTemplateOutlet, RokuTranslatorPipe, QuantityReel],
  templateUrl: './line-lists-summary.html',
  styleUrl: './line-lists-summary.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineListsSummary {
  private readonly _store = inject(BasketStore);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The basket line these rows are about. */
  readonly lineId = input.required<string>();

  /**
   * Whether the trip is over, which takes the controls off and leaves the numbers.
   *
   * The same treatment the row one screen up gives a finished basket: everything it
   * **says** stays, because a finished basket is the receipt for a trip somebody
   * took, and every control goes, because the server refuses all of these writes on
   * one (velista `0057`, section 6). Absent rather than disabled, per `0030`.
   */
  readonly finished = input(false);

  /** The ceiling the asked for reel carries, stated once for the template. */
  protected readonly askedMax = ORIGIN_QUANTITY_MAX;

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

  /** Whether the lists that asked for nothing are showing. Closed by default. */
  private readonly _restOpen = signal(false);

  /** The rows with a write in flight, which makes both their reels readonly. */
  private readonly _busy = signal<ReadonlySet<string>>(new Set());

  /** The last thing each row's write had to say, in the row's own words. */
  private readonly _notices = signal<ReadonlyMap<string, readonly RowNotice[]>>(
    new Map()
  );

  /**
   * Rows whose write was refused with `forbidden`, which loses them their reels.
   *
   * Held here rather than folded into the origin, because it is this session's own
   * observation and not something the read said: the next reload answers `writable`
   * for itself, and the two must not be able to disagree in the direction that draws
   * a control the server refuses.
   */
  private readonly _forbidden = signal<ReadonlySet<string>>(new Set());

  /**
   * Where the asked for reel should sit after a refused lower, by row.
   *
   * A contribution refused for going under what has already been bought returns to
   * the floor rather than to where it started, because the floor is where the reader
   * was heading. The **next** `from` is still the real contribution, which is why
   * this is a display value and lives apart from the origin.
   */
  private readonly _floors = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly state = this._state.asReadonly();
  protected readonly restOpen = this._restOpen.asReadonly();
  protected readonly busy = this._busy.asReadonly();

  /** The line this summary is about, read live so a write updates it under us. */
  private readonly _line = computed<BasketLine | null>(
    () => this._store.lines().find((row) => row.id === this.lineId()) ?? null
  );

  /**
   * Whether the read has been asked for.
   *
   * A field and not a signal: nothing draws it, and an effect that wrote a signal it
   * also reads would be a loop.
   */
  private _readAsked = false;

  constructor() {
    // Read once the basket is ready, and never before: the line this is about does
    // not exist until then, and a read fired at construction would be about an id
    // the store has nothing to say for yet.
    effect(() => {
      if (this._readAsked || this._store.state() !== 'ready') {
        return;
      }
      this._readAsked = true;
      void this._read(true);
    });
  }

  /** Ask again after a failed read. The only thing the failed state offers. */
  protected retry(): void {
    void this._read(true);
  }

  protected toggleRest(): void {
    this._restOpen.update((open) => !open);
  }

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
   * The lists that asked for some of this, one row each.
   *
   * An origin at zero is not one of them: it asked for nothing, which is the same
   * answer as a list that never did, so it sits with them behind the control below.
   */
  protected readonly asked = computed<readonly SummaryRow[]>(() =>
    this._originRows()
      .filter((row) => row.asked > 0)
      .sort(byRunThenName)
  );

  /**
   * The lists that asked for nothing, in the order `0068` section 4.3 states.
   *
   * Two runs with no heading between them, because they are one answer to the reader
   * ("these lists are not asking for any of this") and two different writes: the
   * first holds a line a raise would take over, and the second has none and gets one
   * made. It survives the move off the units sheet because raising one from zero is
   * the only way an added line reaches a household (`0056`, folded into `0068`).
   */
  protected readonly rest = computed<readonly SummaryRow[]>(() => [
    ...this._originRows()
      .filter((row) => row.asked === 0)
      .sort(byRunThenName),
    ...[...this._candidateRows()].sort(byRunThenName),
    ...[...this._otherRows()].sort(byRunThenName),
  ]);

  /** Whether the read came back with nothing at all to show. */
  protected readonly empty = computed(
    () => this.asked().length === 0 && this.rest().length === 0
  );

  /** What the rows say the lists asked for, as the last read and write left them. */
  private readonly _contributed = computed(() =>
    this._originRows().reduce((sum, row) => sum + row.asked, 0)
  );

  /** What the lists between them are asking for, for the sentence under the rows. */
  protected readonly listsWant = this._contributed;

  /**
   * How much of the line nobody asked for.
   *
   * Nothing creates this any more (backend `0104`, section 2.1), because the row's
   * number can no longer be raised above what the lists asked for. The lines that
   * already have it are still readable, which is what this sentence is for.
   */
  protected readonly extra = computed(() => {
    const line = this._line();
    return line === null ? 0 : Math.max(0, line.quantity - this._contributed());
  });

  /**
   * One row's asked for number, set.
   *
   * `from` is {@link SummaryRow.asked} and never the reel's own starting number.
   * They are the same until a refusal moves the displayed value to the floor, and
   * after one the reel's number is a suggestion while the contribution is still what
   * the server last told us. Sending the suggestion would turn a refusal into an
   * overwrite.
   *
   * The zone line is **omitted** for a list holding none, which is the whole of what
   * makes this the same call as sending a line somewhere: the server creates the line
   * and answers the id it landed on, which is not always the one a fresh add would
   * have made (backend `0092`, section 4.2).
   */
  protected async commitAsked(
    row: SummaryRow,
    change: { from: number; to: number }
  ): Promise<void> {
    if (row.reason !== null || change.to === row.asked) {
      return;
    }

    this._clear(row.key);
    this._setBusy(row.key, true);

    const result = await this._store.setOriginQuantity(this.lineId(), {
      listId: row.listId,
      ...(row.sourceLineId === null ? {} : { lineId: row.sourceLineId }),
      quantity: change.to,
      from: row.asked,
    });

    this._setBusy(row.key, false);

    if (result === null) {
      await this._reportAsked(row);
      return;
    }

    if (result.origin === null) {
      // Zero drops the origin (backend 0057, section 5.3), and the list goes back to
      // asking for nothing. Re-read rather than move the row by hand: whether it can
      // be raised again is a question about claims and approvals that only the
      // server can answer.
      await this._read(false);
      return;
    }

    this._record(row, result.origin, result.line);
  }

  /**
   * One row's got number, set. A purchase, or a purchase taken back.
   *
   * The opposite act to {@link commitAsked} on the same row, which is why it is the
   * other call: raising settles the difference against this list alone and lowering
   * takes that list's newest purchases back.
   *
   * **Everything drawn afterwards comes out of the answer.** A `NOT_AVAILABLE` close
   * has no units to divide, so any raise takes the whole close back and the line's
   * outstanding number lands above where this reel was dragged (backend `0104`,
   * section 5). The store applies the answered line, so the number above the rows is
   * right without this knowing the rule.
   */
  protected async commitGot(
    row: SummaryRow,
    change: { from: number; to: number }
  ): Promise<void> {
    if (
      row.reason !== null ||
      row.sourceLineId === null ||
      change.to === row.got
    ) {
      return;
    }

    this._clear(row.key);
    this._setBusy(row.key, true);

    const result = await this._store.setOriginSettled(this.lineId(), {
      lineId: row.sourceLineId,
      settled: change.to,
      from: row.got,
    });

    this._setBusy(row.key, false);

    if (result === null) {
      await this._reportGot(row);
      return;
    }

    const origin = result.origin;
    if (origin === null) {
      // The zone line went out from under the basket. Only a fresh read can say what
      // the row is now, and it may no longer be a row at all.
      await this._read(false);
      return;
    }

    this._written.update((held) => new Map(held).set(row.key, origin));

    if (result.skippedCount > 0) {
      // A settle that could not reach every origin is still a settle, and somebody
      // who has bought the thing has to be told part of it did not land (backend
      // `0051`, section 6.4). The same sentence the sheet draws for its own settles.
      this._notice(row.key, 'basket.settle.missed', {
        count: result.skippedCount,
      });
    }
  }

  /**
   * Read every list this reader may write.
   *
   * `first` is what decides whether a failure takes the block. The opening read has
   * nothing to keep, so it fails to a sentence and a retry; a re-read after a write
   * has rows on screen that are still true, and replacing them with a spinner would
   * take away the numbers somebody is in the middle of correcting.
   *
   * The settle buttons above are unaffected either way, which is section 3.4: a
   * shopper who opened the sheet to press "Got all" must not be held up by a read
   * about lists.
   */
  private async _read(first: boolean): Promise<void> {
    if (first) {
      this._state.set('loading');
    }

    const answer = await this._store.loadLineOrigins(this.lineId());

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
   * Take what an asked for write answered, and say what it did that the numbers do
   * not.
   *
   * The row keeps its place: what changes is the numbers behind it. Both sentences
   * are drawn from the answer rather than inferred, because "the flat now knows
   * about batteries and needs none" is a strange enough outcome that it has to be
   * said in words the moment it happens.
   *
   * Both are said **only on the answer that put this list on the line**. A later edit
   * of a row that has always been bought against is not news, and repeating "some
   * are still waiting" on every drag would turn a fact into wallpaper.
   */
  private _record(
    row: SummaryRow,
    origin: BasketLineOriginDetail,
    line: BasketLine
  ): void {
    this._written.update((held) => new Map(held).set(row.key, origin));

    if (row.asked > 0) {
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

    // And what those purchases could not fill, because this list asked for fewer
    // than were waiting. Said so the shopper knows a second list would take the
    // rest, rather than leaving them to work it out from two numbers on two screens.
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
   * Say what went wrong on an asked for write, on the row it went wrong on.
   *
   * Each of these leaves the reader somewhere different: a number somebody else
   * moved first, a raise that landed on a list already holding this line, a number
   * under what has already been bought, access that has gone since the sheet opened,
   * and a list whose own answer about this line changed underneath the read.
   */
  private async _reportAsked(row: SummaryRow): Promise<void> {
    const error = this._store.error();
    const key = basketErrorKey(error, 'basket.origins');
    const code = error instanceof GatewayError ? error.code : null;

    if (code === 'forbidden') {
      // The row keeps its numbers and loses its controls, in place. They are still
      // facts about a list this reader is entitled to; what has gone is the ability
      // to write.
      this._forbidden.update((held) => new Set(held).add(row.key));
      return;
    }

    if (code === 'below_settled') {
      this._floors.update((held) => new Map(held).set(row.key, row.got));
      this._notice(row.key, key, { count: row.got });
      return;
    }

    if (code === 'stale_quantity') {
      // The store has already refetched the basket, which is the line. The lists are
      // a second read and this is where it happens, so the sentence can name the
      // number this list is actually at rather than saying only that something
      // failed.
      await this._read(false);
      if (row.sourceLineId === null) {
        // A raise on a list this read said held no such line, refused because it
        // does (backend `0092`, section 4.2). Nothing moved underneath the reader's
        // arithmetic, so the sentence is about the list rather than about a number.
        this._notice(row.key, 'basket.units.alreadyHere', {});
        return;
      }
      this._notice(row.key, key, { count: this._askedOf(row.key) });
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

  /**
   * Say what went wrong on a got write.
   *
   * Fewer cases than its sibling, because fewer are reachable: this write names a
   * line that is already an origin, so nothing here adopts, creates or drops one. A
   * stale number is re-read for the same reason the other one is, and a `forbidden`
   * takes the controls off the row and leaves what it says.
   */
  private async _reportGot(row: SummaryRow): Promise<void> {
    const error = this._store.error();
    const key = basketErrorKey(error, 'basket.originSettled');
    const code = error instanceof GatewayError ? error.code : null;

    if (code === 'forbidden') {
      this._forbidden.update((held) => new Set(held).add(row.key));
      return;
    }

    if (code === 'stale_quantity') {
      await this._read(false);
      this._notice(row.key, key, { count: this._gotOf(row.key) });
      return;
    }

    this._notice(row.key, key, {});
  }

  /** What the fresh read says this row asked for, zero if it no longer asks. */
  private _askedOf(key: string): number {
    return this._originRows().find((row) => row.key === key)?.asked ?? 0;
  }

  /** What the fresh read says this basket has bought for this row's list. */
  private _gotOf(key: string): number {
    return this._originRows().find((row) => row.key === key)?.got ?? 0;
  }

  /** Why the fresh read says this row cannot be moved, or null if it can. */
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
  private readonly _originRows = computed<readonly SummaryRow[]>(() =>
    this._origins().map((origin) => {
      const now = this._written().get(origin.lineId) ?? origin;
      return this._row({
        key: origin.lineId,
        listId: now.listId,
        sourceLineId: now.lineId,
        listName: now.listName,
        zoneName: now.zoneName,
        fromRun: now.fromRun,
        asked: now.contributed,
        got: now.settledHere,
        listQuantity: now.listQuantity,
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
        // keeps its numbers and loses its controls.
        reason: now.writable ? null : 'basket.units.noAccess',
      });
    })
  );

  /** The lists holding the same thing that have not been raised yet. */
  private readonly _candidateRows = computed<readonly SummaryRow[]>(() =>
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
        asked: now?.contributed ?? 0,
        got: now?.settledHere ?? 0,
        listQuantity: now?.listQuantity ?? candidate.listQuantity,
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
  private readonly _otherRows = computed<readonly SummaryRow[]>(() =>
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
        asked: now?.contributed ?? 0,
        got: now?.settledHere ?? 0,
        listQuantity: now?.listQuantity ?? 0,
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
      SummaryRow,
      | 'key'
      | 'listId'
      | 'sourceLineId'
      | 'fromRun'
      | 'asked'
      | 'got'
      | 'listQuantity'
      | 'pending'
      | 'matchedOnText'
      | 'listCaption'
      | 'reason'
    > & {
      readonly listName: string | null;
      readonly zoneName: string | null;
    }
  ): SummaryRow {
    const named = source.listName !== null && source.listName !== '';
    // Named where a name is known. A reader who sees this summary passes the all or
    // nothing rule, so the names are theirs by construction; the fallback covers a
    // list deleted since rather than a redacted one.
    const label = named
      ? (source.listName as string)
      : this._translator.t('basket.unnamed', undefined, this._locale());
    const zoneName =
      named && this._ambiguous().has(source.listName as string)
        ? source.zoneName
        : null;
    const locale = this._locale();
    // The zone is part of the reel's name where the list alone would name two of
    // them, which is the same rule the visible caption follows.
    const whose =
      zoneName === null || zoneName === '' ? label : `${label} (${zoneName})`;

    return {
      key: source.key,
      listId: source.listId,
      sourceLineId: source.sourceLineId,
      label,
      askedLabel: this._translator.t(
        'basket.units.askedLabel',
        undefined,
        locale,
        { name: whose }
      ),
      gotLabel: this._translator.t('basket.units.gotLabel', undefined, locale, {
        name: whose,
      }),
      zoneName,
      zoneKey: source.zoneName ?? '',
      fromRun: source.fromRun,
      asked: source.asked,
      got: source.got,
      listQuantity: source.listQuantity,
      listCaption: source.listCaption,
      pending: source.pending,
      matchedOnText: source.matchedOnText,
      reason: this._forbidden().has(source.key)
        ? 'basket.units.noAccess'
        : source.reason,
      notices: this._notices().get(source.key) ?? [],
      shownAsked: this._floors().get(source.key) ?? source.asked,
    };
  }
}

/**
 * The run's own lists first, then by zone and by list name (backend `0092`).
 *
 * The server sorts nothing and says so, because the order is a fact about the person
 * reading rather than about the data: somebody adding bread in an aisle almost
 * always means one of the lists the basket came from.
 *
 * By zone before list, so two lists in one household stay together, and by the
 * reader's own locale, so accented names fall where a Spanish speaker expects.
 */
function byRunThenName(left: SummaryRow, right: SummaryRow): number {
  if (left.fromRun !== right.fromRun) {
    return left.fromRun ? -1 : 1;
  }
  const zone = left.zoneKey.localeCompare(right.zoneKey);
  return zone === 0 ? left.label.localeCompare(right.label) : zone;
}
