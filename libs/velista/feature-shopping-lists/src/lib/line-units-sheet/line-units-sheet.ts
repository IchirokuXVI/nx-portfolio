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
 * What one row of this sheet says, whether it is a list that is already in or one that
 * could be.
 *
 * One shape for both, because they are drawn identically and differ only in what they
 * start at and what may stop them: an origin starts at what it contributed, a candidate
 * starts at zero, and moving either is the same write. Two view models would have made
 * the template branch on which collection a row came from, which is exactly the fact a
 * reader is not supposed to have to hold.
 */
interface UnitsRow {
  /**
   * The zone line, which is what identifies a row here.
   *
   * A list can hold two lines the run merged into one basket line, so the list id does
   * not identify a row and the origin id does not exist yet for a candidate. The zone
   * line is the one identifier both collections carry and the write addresses.
   */
  readonly key: string;
  readonly listId: string;
  readonly lineId: string;
  /** The list's name, or the fallback phrase when the basket was told none. */
  readonly label: string;
  /**
   * The reel's accessible name, which is the list and the zone where the list alone
   * would name two of them (section 7).
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
  /** What this list put into the basket line. Zero for a candidate. */
  readonly contributed: number;
  /** What the zone line asks for now, which is a different number the moment either moves. */
  readonly listQuantity: number;
  /** What this basket has already settled against this origin: the floor. */
  readonly settledHere: number;
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
  /** What went wrong on this row's last write, if anything did. */
  readonly notice: RowNotice | null;
  /** What the reel should show, which is the floor after a refusal and the contribution otherwise. */
  readonly shown: number;
}

/** One sentence on one row, with whatever number it names. */
interface RowNotice {
  readonly key: string;
  /** Interpolation for the key, empty where it takes none. */
  readonly values: Readonly<Record<string, number>>;
}

/** What a candidate that cannot be adopted says, keyed on the server's reason. */
const UNAVAILABLE_KEY: Readonly<Record<string, string>> = {
  CLAIMED: 'basket.units.claimed',
  NOT_APPROVED: 'basket.units.notApproved',
  SETTLED: 'basket.units.settled',
};

/**
 * Changing what each list asked for (plan 0055).
 *
 * A basket line of three litres of milk is the flat wanting two and the parents' house
 * wanting one. This is the sheet that shows that split and lets a reader who passes the
 * all or nothing rule move each number, including putting a list into a line the run
 * composed without it.
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
 * whether they narrate one. And the copy on every row is about **wanting** rather than
 * about getting.
 *
 * ## One write per row, on release, and never a save button
 *
 * A sheet that collected five numbers and applied them together would have to explain a
 * partial failure. Applying them one at a time means the row that failed is the row that
 * says so, which is section 6 and is why every failure here lands on a row rather than
 * on the sheet.
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

  /** Whether the lists that are not in are showing. Closed by default (section 4.3). */
  private readonly _othersOpen = signal(false);

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

  /** The last failure on each row, in the row's own words. */
  private readonly _notices = signal<ReadonlyMap<string, RowNotice>>(new Map());

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
   * Section 6: a contribution refused for going under what has already been bought
   * returns to the floor rather than to where it started, because the floor is where
   * the reader was heading. The **next** `from` is still the real contribution, which
   * is why this is a display value and lives apart from the origin.
   */
  private readonly _floors = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly state = this._state.asReadonly();
  protected readonly othersOpen = this._othersOpen.asReadonly();
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
   * Origins and candidates together, because the ambiguity a reader suffers is on the
   * screen and not in one collection: a list called Food that is in and a second called
   * Food that could be are two rows with one name however they arrived.
   */
  private readonly _ambiguous = computed<ReadonlySet<string>>(() => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    const names = [
      ...this._origins().map((origin) => origin.listName),
      ...this._candidates().map((candidate) => candidate.listName),
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

  /** The lists that are in, one row each (section 4.2). */
  protected readonly rows = computed<readonly UnitsRow[]>(() =>
    this._origins().map((origin) =>
      this._row({
        key: origin.lineId,
        listId: origin.listId,
        lineId: origin.lineId,
        listName: origin.listName,
        zoneName: origin.zoneName,
        contributed: origin.contributed,
        listQuantity: origin.listQuantity,
        settledHere: origin.settledHere,
        matchedOnText: null,
        // `writable` is the server's answer about the **owner's** access, which is what
        // authorizes every write made from this basket. A row it says no to keeps its
        // numbers and loses its control.
        reason: origin.writable ? null : 'basket.units.noAccess',
      })
    )
  );

  /** The lists that are not, behind the disclosure (section 4.3). */
  protected readonly others = computed<readonly UnitsRow[]>(() =>
    this._candidates().map((candidate) =>
      this._row({
        key: candidate.lineId,
        listId: candidate.listId,
        lineId: candidate.lineId,
        listName: candidate.listName,
        zoneName: candidate.zoneName,
        // Nothing yet, which is what makes moving one off zero an adoption.
        contributed: 0,
        listQuantity: candidate.listQuantity,
        settledHere: 0,
        // Drawn distinctly on purpose (backend 0057, section 8): the run merges on
        // normalized text as its last resort, so a match made that way is one the
        // reader should confirm rather than one the run would have been sure of.
        matchedOnText: candidate.matchedOnText ? candidate.content : null,
        reason:
          candidate.unavailable === null
            ? null
            : (UNAVAILABLE_KEY[candidate.unavailable] ?? null),
      })
    )
  );

  /** Whether the read came back with nothing at all to show. */
  protected readonly empty = computed(
    () => this.rows().length === 0 && this.others().length === 0
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
    for (const row of [...this.rows(), ...this.others()]) {
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

  /** What the origins say they put in, as the last read left them. */
  private readonly _contributed = computed(() =>
    this._origins().reduce((sum, origin) => sum + origin.contributed, 0)
  );

  constructor() {
    void this._read(true);
  }

  /** Ask again after a failed read. The only thing the failed state offers. */
  protected retry(): void {
    void this._read(true);
  }

  protected toggleOthers(): void {
    this._othersOpen.update((open) => !open);
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
   * One row's contribution, set (section 6).
   *
   * `from` is {@link UnitsRow.contributed} and never the reel's own starting number.
   * They are the same until a refusal moves the displayed value to the floor, and after
   * one the reel's number is a suggestion while the contribution is still what the
   * server last told us. Sending the suggestion would turn a refusal into an overwrite.
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
      lineId: row.lineId,
      quantity: change.to,
      from: row.contributed,
    });

    this._setBusy(row.key, false);

    if (result === null) {
      await this._report(row);
      return;
    }

    if (result.origin === null) {
      // Zero drops the origin (backend 0057, section 5.3), and the list becomes a
      // candidate again. Re-read rather than move the row across by hand: whether it
      // is still adoptable is a question about claims and approvals that only the
      // server can answer.
      await this._read(false);
      return;
    }

    this._patch(result.origin);
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
   * Read the origins and the candidates.
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
    // A fresh read is the server's own answer about access and about floors, so this
    // session's observations of both go with it rather than outliving what produced
    // them.
    this._forbidden.set(new Set());
    this._floors.set(new Map());
    this._state.set('loaded');
  }

  /**
   * Fold a written origin back into the rows.
   *
   * An adoption arrives here too: the candidate leaves that collection and joins the
   * origins, which is the same movement on screen as the list joining the line.
   */
  private _patch(origin: BasketLineOriginDetail): void {
    this._candidates.update((held) =>
      held.filter((candidate) => candidate.lineId !== origin.lineId)
    );
    this._origins.update((held) => {
      const known = held.some((row) => row.lineId === origin.lineId);
      return known
        ? held.map((row) => (row.lineId === origin.lineId ? origin : row))
        : [...held, origin];
    });
  }

  /**
   * Say what went wrong, on the row it went wrong on, with the sheet still open.
   *
   * Three of these are not bugs and each gets its own treatment, because each leaves the
   * reader somewhere different: a number somebody else moved first, a number under what
   * has already been bought, and access that has gone since the sheet opened.
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
      // The store has already refetched the basket, which is the line. The origins are a
      // second read and this is where it happens, so the sentence can name the number
      // this list is actually at rather than saying only that something failed.
      await this._read(false);
      this._notice(row.key, key, { count: this._contributionOf(row.lineId) });
      return;
    }

    this._notice(row.key, key, {});
  }

  /** What the fresh read says this zone line contributes, zero if it no longer does. */
  private _contributionOf(lineId: string): number {
    return (
      this._origins().find((origin) => origin.lineId === lineId)?.contributed ??
      0
    );
  }

  private _notice(
    key: string,
    messageKey: string,
    values: Readonly<Record<string, number>>
  ): void {
    this._notices.update((held) =>
      new Map(held).set(key, { key: messageKey, values })
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

  /** One row, from whichever collection it came out of. */
  private _row(
    source: Pick<
      UnitsRow,
      | 'key'
      | 'listId'
      | 'lineId'
      | 'contributed'
      | 'listQuantity'
      | 'settledHere'
      | 'matchedOnText'
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
      lineId: source.lineId,
      label,
      reelLabel:
        zoneName === null || zoneName === '' ? label : `${label} (${zoneName})`,
      zoneName,
      contributed: source.contributed,
      listQuantity: source.listQuantity,
      settledHere: source.settledHere,
      matchedOnText: source.matchedOnText,
      reason: this._forbidden().has(source.key)
        ? 'basket.units.noAccess'
        : source.reason,
      notice: this._notices().get(source.key) ?? null,
      shown: this._floors().get(source.key) ?? source.contributed,
    };
  }
}
