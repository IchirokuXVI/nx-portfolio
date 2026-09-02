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
  type BasketBindResult,
  type BasketLine,
  type BasketLineTarget,
} from '@portfolio/velista/models';
import {
  generatedListIdOf,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { SheetShell } from '@portfolio/velista/ui';
import {
  basketErrorKey,
  correlationIdOf,
  type BasketOperation,
} from '../basket-error-copy';
import { settleSheetPath } from '../basket-paths';

/** How the read of what this line may be sent to has got on. */
type TargetsLoad = 'loading' | 'loaded' | 'failed';

/**
 * How many lists it takes before the sheet offers a search field.
 *
 * Eight, which is about a screenful on a phone: below it the field would be a
 * control between the reader and an answer they can already see, and above it the
 * list is something to scroll rather than something to read. A constant rather
 * than a literal in the computed, because it is the one number in this file
 * somebody may want to argue with.
 */
const SEARCH_THRESHOLD = 8;

/**
 * One heading and the lists under it.
 *
 * The heading is resolved here rather than in the template because it comes from
 * two different places: the run's own group is a translated string, and every
 * other group is a zone's name as the server sent it. A template that branched
 * would be the place those two drift into looking different.
 */
interface TargetGroup {
  /** Stable across a filter, so `@for` does not rebuild the list on each keystroke. */
  readonly key: string;
  readonly heading: string;
  /**
   * Whether each row repeats which group its list is in.
   *
   * True only for the run's own group, whose rows come from several zones and are
   * therefore the only ones a heading does not already place. Repeating it under a
   * zone heading would print the same word twice on every row.
   */
  readonly showZone: boolean;
  readonly targets: readonly BasketLineTarget[];
}

/**
 * Case and accent insensitive text, for the search.
 *
 * A person hunting for "Parents' house" in an aisle types `parents`, and somebody
 * on a Spanish keyboard in a hurry types `mama` for `Mamá`. Both should find the
 * list. `NFD` splits the accent off the letter and the class drops it, which is
 * the cheapest fold that does not need a collator per keystroke.
 */
function fold(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Sending a line somebody typed in the shop to a shopping list (plan 0056).
 *
 * A line added in the basket lives in the basket and nowhere else, which is the
 * right default and deliberately not the end: somebody buys batteries because the
 * flat kept running out, and the flat's list should learn that batteries are a
 * thing the flat runs out of. This sheet is the one gesture that says which list.
 *
 * ## It composes nothing and reaches no zone store
 *
 * Every name on this screen comes off the targets read. That is not a convenience:
 * the basket screen must not grow a way to read zones, because a screen that can
 * name a household is a screen a template mistake could show one to a guest, which
 * is the reasoning `0049` section 1.2 used for the skip report's names. The server
 * already answers with each list's zone and whether the run drew from it, so the
 * grouping and the ordering are the only things done here.
 *
 * ## Who reaches it
 *
 * The settle sheet draws the entry only for the owner or a registered participant
 * passing the all or nothing rule, on an `ADDED` line that has been sent nowhere.
 * A guest never sees it, and the reason is not distrust: every row of this sheet is
 * a list's name, and naming a list to a guest is the disclosure the whole basket is
 * built to prevent. Their line stays where they put it and anybody with an account
 * can send it on, with the person who added it still named on the row.
 *
 * ## The confirm is a real one
 *
 * Unlike the reels in `0054` and `0055`, which commit on release, this waits for a
 * deliberate tap and says first that it cannot be undone from here. The difference
 * is reversibility: those two move a number that can be moved back, and this one
 * creates a row on somebody else's screen. Taking it back out is done on that list,
 * by somebody with access, as an ordinary delete (`0050` section 5).
 *
 * Nothing is preselected for the same reason. The whole gesture is somebody saying
 * which list, and a preselected row is a default that can be committed by accident.
 */
@Component({
  selector: 'lib-line-list-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './line-list-sheet.html',
  styleUrl: './line-list-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineListSheet {
  private readonly _store = inject(BasketStore);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;

  /** The basket underneath, for the settle sheet this one closes onto. */
  private readonly _generatedListId = generatedListIdOf(this._route);
  private readonly _lineId = this._route.snapshot.paramMap.get('lineId') ?? '';

  private readonly _targets = signal<readonly BasketLineTarget[]>([]);
  private readonly _loadState = signal<TargetsLoad>('loading');
  private readonly _query = signal('');
  private readonly _chosenListId = signal<string | null>(null);
  private readonly _busy = signal(false);
  /**
   * Which act failed, or null if none has.
   *
   * Only ever `basket.bind`, because the one write this sheet makes is the bind and
   * the targets read has a whole state of its own with a retry on it. Kept as the
   * operation rather than a boolean so the copy is keyed the way the rest of this
   * screen keys it: `forbidden`, `validation_failed` and `conflict` each mean
   * something specific here and each gets its own sentence.
   */
  private readonly _failedOp = signal<BasketOperation | null>(null);
  private readonly _result = signal<BasketBindResult | null>(null);

  protected readonly loadState = this._loadState.asReadonly();
  protected readonly busy = this._busy.asReadonly();
  protected readonly query = this._query.asReadonly();
  protected readonly chosenListId = this._chosenListId.asReadonly();
  protected readonly result = this._result.asReadonly();

  /** The line this sheet is about, read live so the bind updates it under us. */
  protected readonly line = computed<BasketLine | null>(
    () => this._store.lines().find((row) => row.id === this._lineId) ?? null
  );

  /** What the reader typed, which is what the sheet is titled by. */
  protected readonly title = computed(() => this.line()?.content ?? '');

  /**
   * Whether there are enough lists for the search field to earn its place.
   *
   * Measured on everything the server answered rather than on what is currently
   * shown, so a filter that narrows the list to two does not take away the field
   * that narrowed it.
   */
  protected readonly searchable = computed(
    () => this._targets().length > SEARCH_THRESHOLD
  );

  /**
   * The targets the search leaves, on the list's name and on its zone's.
   *
   * Both, because a person looking for the flat's list may remember either half of
   * "Weekly shop, Flat 3B", and which half they remember is not something this
   * screen can know.
   */
  protected readonly matched = computed<readonly BasketLineTarget[]>(() => {
    const query = fold(this._query().trim());
    if (query === '') {
      return this._targets();
    }
    return this._targets().filter(
      (target) =>
        fold(target.listName ?? '').includes(query) ||
        fold(target.zoneName ?? '').includes(query)
    );
  });

  /** How many lists the current search leaves, announced politely. */
  protected readonly matchCount = computed(() => this.matched().length);

  /**
   * Whether there is nowhere to send this line at all.
   *
   * Distinct from a search that matched nothing, which the count already reports: a
   * reader who has narrowed nine lists down to none has not run out of lists, and
   * telling them they have would be the screen answering a question they did not
   * ask.
   */
  protected readonly noTargets = computed(() => this._targets().length === 0);

  /**
   * The lists to choose from: the run's own first, then one group per zone.
   *
   * The server sorts nothing and says so (backend `0058` section 3): it answers a
   * set with a `fromRun` flag, and the whole ergonomics of the picker is what this
   * does with it. The line was almost certainly remembered while shopping for the
   * lists this basket came from, so those are one group at the top and the answer is
   * usually one tap.
   *
   * A list that the run drew from appears once, at the top, and not again under its
   * zone: it is the same list, and offering it twice would make the picker's one
   * question look like two.
   */
  protected readonly groups = computed<readonly TargetGroup[]>(() => {
    const locale = this._locale();
    const compare = this._collator(locale);
    const byName = (a: BasketLineTarget, b: BasketLineTarget) =>
      compare(this._listName(a), this._listName(b));

    const matched = this.matched();
    const fromRun = matched.filter((target) => target.fromRun);
    const rest = matched.filter((target) => !target.fromRun);

    const groups: TargetGroup[] = [];
    if (fromRun.length > 0) {
      groups.push({
        key: 'run',
        heading: this._translator.t(
          'basket.send.fromThisBasket',
          undefined,
          locale
        ),
        showZone: true,
        targets: [...fromRun].sort(byName),
      });
    }

    const zones = new Map<string, BasketLineTarget[]>();
    for (const target of rest) {
      const existing = zones.get(target.zoneId);
      if (existing === undefined) {
        zones.set(target.zoneId, [target]);
      } else {
        existing.push(target);
      }
    }

    const zoneGroups = [...zones.entries()]
      .map(([zoneId, targets]) => ({
        key: `zone:${zoneId}`,
        heading: this._zoneName(targets[0], locale),
        showZone: false,
        targets: [...targets].sort(byName),
      }))
      .sort((a, b) => compare(a.heading, b.heading));

    return [...groups, ...zoneGroups];
  });

  /** The list the reader has picked, or null while the question is still open. */
  protected readonly chosen = computed<BasketLineTarget | null>(() => {
    const listId = this._chosenListId();
    return listId === null
      ? null
      : (this._targets().find((target) => target.listId === listId) ?? null);
  });

  /** What to call the chosen list, in the warning and in the outcome. */
  protected readonly chosenName = computed(() => {
    const target = this.chosen();
    return target === null ? '' : this._listName(target);
  });

  /**
   * The one sentence the sheet is saying right now, as a key, or null for none.
   *
   * One region rather than two, which is what section 6 asks for: the warning has to
   * be heard **before** the button rather than after the commit, and the outcome
   * replaces it in the same place. Two live regions would race, and a region created
   * at the same moment as its first content is one some readers never announce.
   *
   * The three outcomes are three different facts and are told apart in this order.
   * A list waiting for approval is the most surprising, so it wins even when nothing
   * was outstanding: "added, and they have not agreed yet" is the thing that has to
   * be said. A zero quantity is the next, because "the flat now knows about batteries
   * and does not need any today" is a strange outcome to arrive at silently
   * (section 5.2).
   */
  protected readonly sayKey = computed<string | null>(() => {
    const result = this._result();
    if (result !== null) {
      if (result.pendingApproval) {
        return 'basket.send.waiting';
      }
      return result.quantity === 0
        ? 'basket.send.noneOutstanding'
        : 'basket.send.done';
    }
    return this.chosen() === null ? null : 'basket.send.warning';
  });

  /** What that sentence names: the line, in the reader's own words, and the list. */
  protected readonly sayParams = computed(() => ({
    content: this.title(),
    list: this.chosenName(),
  }));

  /**
   * What to say about a refused bind, or null when there has not been one.
   *
   * The code comes from {@link BasketStore.error} and the operation from
   * {@link _failedOp}. The server's own message is deliberately not used: the
   * gateway's catalog gives every code one message, so it reads identically for
   * every conflict in the product.
   */
  protected readonly errorKey = computed<string | null>(() => {
    const operation = this._failedOp();
    return operation === null
      ? null
      : basketErrorKey(this._store.error(), operation);
  });

  protected readonly correlationId = computed<string | null>(() =>
    this._failedOp() === null ? null : correlationIdOf(this._store.error())
  );

  constructor() {
    void this.load();
  }

  /** Ask which lists this line may be sent to. Also the retry. */
  protected async load(): Promise<void> {
    this._loadState.set('loading');
    const targets = await this._store.loadLineTargets(this._lineId);
    if (targets === null) {
      this._loadState.set('failed');
      return;
    }
    this._targets.set(targets);
    this._loadState.set('loaded');
  }

  protected search(query: string): void {
    this._query.set(query);
  }

  /**
   * Pick one list, which is what makes the confirm exist at all.
   *
   * Clears the last failure with it: a refusal is about the list that was tried, and
   * leaving the sentence up while somebody chooses a different one would have the
   * sheet reporting on a choice they have already moved off.
   */
  protected choose(listId: string): void {
    this._chosenListId.set(listId);
    this._failedOp.set(null);
  }

  /**
   * Send it, once.
   *
   * Guarded on `_busy` as well as being drawn disabled, because the button is not the
   * only thing that can reach here: a second `Enter` on a focused control while the
   * first request is out would otherwise ask the server to create the line twice, and
   * the server refuses the second with `conflict`, which reads to the reader as a
   * failure of something that in fact worked.
   */
  protected async confirm(): Promise<void> {
    const listId = this._chosenListId();
    if (listId === null || this._busy()) {
      return;
    }

    this._busy.set(true);
    this._failedOp.set(null);
    const result = await this._store.bindLine(this._lineId, listId);
    this._busy.set(false);

    if (result === null) {
      this._failedOp.set('basket.bind');
      await this._catchUpAfterRefusal();
      return;
    }

    this._result.set(result);
  }

  /**
   * Cancel, Escape, the scrim and the back button all arrive here.
   *
   * Onto the **settle sheet**, not the basket: this sheet was opened from there and
   * a dismissal that skipped it would take the reader two screens back from one
   * gesture. Named in full through `SheetNavigation`, like every other sheet in the
   * app: a relative climb depends on how many segments some other file's path
   * happens to have, and an ordinary `navigate` pushes, leaving this sheet one back
   * press from reopening (plan 0031).
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
   * Re-read the basket after a refusal that means the entry should not have been
   * drawn.
   *
   * `conflict` is a line already sent and `validation_failed` is a line the run
   * composed, and both mean this sheet was reached from a settle sheet whose gating
   * was decided on a stale basket. The refusal is reported where the reader is, and
   * the read is what takes the entry away behind them, so closing does not land them
   * on a control that would refuse again.
   *
   * Every other code is left alone deliberately. A `forbidden` or a finished basket
   * is a fact about access or about the run, not about this line's state, and a
   * refresh would spend a request without changing anything on screen.
   */
  private async _catchUpAfterRefusal(): Promise<void> {
    const error = this._store.error();
    if (
      error instanceof GatewayError &&
      (error.code === 'conflict' || error.code === 'validation_failed')
    ) {
      await this._store.refresh();
    }
  }

  /** What to call a list the server sent no name for, which is a list, so it says so. */
  private _listName(target: BasketLineTarget): string {
    return (
      target.listName ??
      this._translator.t('basket.unnamed', undefined, this._locale())
    );
  }

  /** The same for a zone, reusing the word the rest of the app calls one by. */
  private _zoneName(
    target: BasketLineTarget | undefined,
    locale: string
  ): string {
    return (
      target?.zoneName ??
      this._translator.t('vocabulary.zone', undefined, locale)
    );
  }

  /**
   * How two names are ordered, in the reader's language.
   *
   * A collator rather than `localeCompare` per comparison, because the sort runs on
   * every keystroke of the search and building the collator once per pass is the
   * whole of the difference. Falls back to the environment's own ordering for a tag
   * `Intl` does not recognise, which it reports by throwing a `RangeError`.
   */
  private _collator(locale: string): (a: string, b: string) => number {
    try {
      return new Intl.Collator(locale, { sensitivity: 'base' }).compare;
    } catch {
      return new Intl.Collator(undefined, { sensitivity: 'base' }).compare;
    }
  }
}
