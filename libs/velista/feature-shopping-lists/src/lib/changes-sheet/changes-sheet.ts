import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketChangeStore, BasketStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  basketChangeSentence,
  type BasketChange,
} from '@portfolio/velista/models';
import { SheetNavigation } from '@portfolio/velista/platform';
import {
  ChangeEntry,
  SheetShell,
  type ChangeEntryView,
} from '@portfolio/velista/ui';
import { ChangeAcknowledger } from '../basket-page/change-acknowledger';
import { basketPath } from '../basket-paths';

/**
 * What changed on the lists this basket covers, told in words (velista `0093`,
 * section 6).
 *
 * ## It reads and it never acts
 *
 * No entry is a button and none opens anything. A change is a fact, and the row
 * it is about is one dismiss away on the page underneath; a control here would
 * be a second route to a row that may not exist any more.
 *
 * The one thing it does write is the acknowledgement, and it does not write it
 * itself: it tells {@link ChangeAcknowledger} how many entries it has drawn,
 * and that class decides, with the document's visibility and the dwell, whether
 * somebody has really looked. A sheet opened and shut inside a second and a
 * half acknowledges nothing.
 *
 * ## Nothing here reads a clock
 *
 * An entry's "New" tag is {@link BasketChange.unseen}, which is the server's
 * answer for this participant on the server's clock. `at` is formatted for
 * display and compared to nothing.
 */
@Component({
  selector: 'lib-changes-sheet',
  imports: [ChangeEntry, RokuTranslatorPipe, SheetShell],
  templateUrl: './changes-sheet.html',
  styleUrl: './changes-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangesSheet {
  private readonly _store = inject(BasketStore);
  private readonly _changes = inject(BasketChangeStore);
  private readonly _acknowledger = inject(ChangeAcknowledger);
  private readonly _sheet = inject(SheetNavigation);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /**
   * The basket underneath, which is where closing this sheet goes.
   *
   * From the **store** and not from `paramMap`, for the reason every sheet over
   * this page reads it there since velista `0091`: the same page is routed at
   * `shopping-lists/live`, where the URL carries no id at all.
   */
  private readonly _address = this._store.address;

  protected readonly state = this._changes.state;
  protected readonly hasMore = this._changes.hasMore;
  protected readonly loadingMore = this._changes.loadingMore;

  /** What "Show more" answered, said through the sheet's polite region. */
  protected readonly announcement = signal('');

  /**
   * The entries, each resolved into the plain strings `lib-change-entry` takes.
   *
   * Composed here rather than in the template, because two of the three pieces
   * cannot be written in one: the sentence is a seven way table that belongs to
   * the model, and the date needs `Intl` and the reader's locale.
   */
  protected readonly entries = computed<readonly ChangeEntryView[]>(() => {
    const locale = this._locale();
    const meId = this._store.me()?.id ?? null;
    const format = dateFormat(locale);

    return this._changes.changes().map((change) => {
      const sentence = basketChangeSentence(change);
      return {
        id: change.id,
        key: sentence.key,
        args: sentence.args,
        who: this._who(change, meId),
        list:
          change.list === null
            ? ''
            : this._translator.t(
                'basket.changes.entry.inList',
                undefined,
                locale,
                { list: change.list.name }
              ),
        when: format(change.at),
        unseen: change.unseen,
      };
    });
  });

  constructor() {
    void this._changes.load();

    // How many changes are really drawn, which is half of what decides an
    // acknowledgement (velista `0093`, section 7). Loading and the empty state
    // both draw zero, because neither has put a change in front of anybody.
    effect(() => {
      this._acknowledger.reportSheetEntries(
        this.state() === 'ready' ? this.entries().length : 0
      );
    });

    // The sheet is a child route, so this really fires: it is the **route's**
    // injector that is never destroyed, and this is the component's. The
    // acknowledger outlives the sheet, so a count left behind would keep the
    // page acknowledging with the sheet shut.
    inject(DestroyRef).onDestroy(() => {
      this._acknowledger.reportSheetEntries(0);
      // The changes are left where they are rather than reset: the page is
      // still open, the store is the route's, and re-opening reads again.
    });
  }

  protected retry(): void {
    void this._changes.load();
  }

  /**
   * "Show more", which keeps focus on the button and says what arrived
   * (velista `0088`, section 10).
   *
   * Focus stays put because moving it to the first new entry loses the place of
   * somebody who wanted to keep reading downwards. So the arrival is announced
   * instead, through the polite region below the list.
   */
  protected async more(): Promise<void> {
    const added = await this._changes.loadMore();
    this.announcement.set(
      added === null
        ? this._translator.t('basket.changes.failed', undefined, this._locale())
        : this._translator.t(
            'basket.changes.loaded',
            undefined,
            this._locale(),
            {
              count: added,
            }
          )
    );
  }

  protected close(): void {
    void this._sheet.dismiss(
      basketPath(this._locale(), this._basePath, this._address())
    );
  }

  /**
   * Who made a change, in words, or the empty string.
   *
   * Three cases and the order matters. The reader themselves is "You", which is
   * the one name that must not be an account's, because a history that says
   * "Dani" to Dani reads as somebody else. A person this client can name is
   * named. Everybody else is "Someone", which covers a guest who typed nothing
   * and an account this reader is not entitled to know about, and those two are
   * deliberately indistinguishable (backend `0130`, section 6).
   *
   * An actor the server withheld entirely draws nothing at all: there is no
   * person in the sentence, so there is none in the line under it either.
   */
  private _who(change: BasketChange, meId: string | null): string {
    const actor = change.actor;
    if (actor === null) {
      return '';
    }

    const locale = this._locale();
    if (meId !== null && actor.participantId === meId) {
      return this._translator.t('basket.history.you', undefined, locale);
    }
    return (
      actor.name ??
      this._translator.t('basket.history.someone', undefined, locale)
    );
  }
}

/**
 * A date and a time in the reader's language, as a reusable formatter.
 *
 * `Intl` and never `DatePipe`, which is this scope's convention: the pipe needs
 * `registerLocaleData` per locale and a `LOCALE_ID` this app does not set,
 * because the language is runtime state rather than the shell's build time
 * locale.
 *
 * A **date and a time**, like the people sheet's join time and unlike a
 * settlement history's day: "today, 10:41" is what tells somebody whether the
 * change on this row is the one they just watched somebody make.
 *
 * Built once per render of the list rather than per entry, because constructing
 * an `Intl.DateTimeFormat` is the expensive half and twenty entries share one.
 */
function dateFormat(locale: string): (at: Date) => string {
  try {
    const format = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return (at) => format.format(at);
  } catch {
    // An unrecognised tag, which `Intl` throws a `RangeError` for. The ISO
    // string is ugly and correct, and an entry with no time would be worse.
    return (at) => at.toISOString();
  }
}
