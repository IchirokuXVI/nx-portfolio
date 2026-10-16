import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  BasketChangeStore,
  BasketStore,
  MemberNames,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  basketChangeOriginLine,
  basketChangeSentence,
  type BasketChange,
  type BasketChangeActor,
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
  private readonly _names = inject(MemberNames);
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
    const me = this._store.me();
    const meId = me?.id ?? null;
    const reader = { participantId: meId, userId: me?.userId ?? null };
    const format = dateFormat(locale);

    return this._changes.changes().map((change) => {
      const sentence = basketChangeSentence(change);
      // Where a buy came from replaces who and which list (velista `0142`,
      // section 4). A buy of this shopping list has no origin and keeps who,
      // with no list.
      const origin = basketChangeOriginLine(change, reader, (person) =>
        this._nameOf(change, person)
      );
      const isBuy = change.kind === 'BOUGHT' || change.kind === 'BUY_REVERTED';
      return {
        id: change.id,
        key: sentence.key,
        args: sentence.args,
        who: origin === null ? this._who(change, meId, reader.userId) : '',
        list:
          origin !== null || isBuy || change.list === null
            ? ''
            : this._translator.t(
                'basket.changes.entry.inList',
                undefined,
                locale,
                { list: change.list.name }
              ),
        origin,
        when: format(change.at),
        unseen: change.unseen,
      };
    });
  });

  /**
   * The zones whose members can name a person the basket cannot (velista
   * `0142`, section 4). The owner of another shopping list, and anybody else
   * who is not on this one, is on no participant row of it. The server serves
   * an account only beside a list the reader was served, so that list's zone is
   * the one to ask, and a guest, served no list, asks nothing.
   */
  private readonly _zonesToName = computed(() => {
    const zones = new Set<string>();
    for (const change of this._changes.changes()) {
      const origin = change.origin;
      const people = [
        change.actor,
        origin?.kind === 'ANOTHER_BASKET' ? origin.owner : null,
      ];
      for (const person of people) {
        if (
          person !== null &&
          person.name === null &&
          person.userId !== null &&
          change.list !== null
        ) {
          zones.add(change.list.zoneId);
        }
      }
    }
    return [...zones];
  });

  /** The basket the sheet reads the changes of, once the page has read it. */
  private readonly _basketId = computed(() => this._store.basket()?.id ?? null);

  constructor() {
    // Once the basket is known, and again only if it is another basket. On a
    // cold load of the sheet's own URL the page has not read the basket yet,
    // and a read asked for then answers nothing, which left the sheet drawing
    // its skeleton for good.
    effect(() => {
      if (this._basketId() !== null) {
        untracked(() => void this._changes.load());
      }
    });

    // Once per zone and only when the sheet holds a buy whose person the basket
    // cannot name: `MemberNames` answers the same map to every screen.
    effect(() => {
      for (const zoneId of this._zonesToName()) {
        void this._names.ensure(zoneId);
      }
    });

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
   * A person a change names, from the basket's participants and then from the
   * members of the zone of the list the change is on, or null for "someone".
   * One rule for an actor and for the owner of another shopping list, so one
   * person is never named on one entry and "Someone" on the next.
   */
  private _nameOf(
    change: BasketChange,
    person: BasketChangeActor
  ): string | null {
    if (person.name !== null) {
      return person.name;
    }
    if (person.userId === null || change.list === null) {
      return null;
    }
    return this._names.nameOf(change.list.zoneId, person.userId);
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
  private _who(
    change: BasketChange,
    meId: string | null,
    myUserId: string | null
  ): string {
    const actor = change.actor;
    if (actor === null) {
      return '';
    }

    const locale = this._locale();
    if (
      (meId !== null && actor.participantId === meId) ||
      (myUserId !== null && actor.userId === myUserId)
    ) {
      return this._translator.t('basket.history.you', undefined, locale);
    }
    return (
      this._nameOf(change, actor) ??
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
