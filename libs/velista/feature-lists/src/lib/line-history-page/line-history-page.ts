import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  ItemNames,
  LineStore,
  ListStore,
  MemberNames,
  SessionStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import type { HistoryScope } from '@portfolio/velista/models';
import { PageNavigation } from '@portfolio/velista/platform';
import { PageHeader } from '@portfolio/velista/ui';
import { linePageStatus, loadLineContext } from '../line-page/line-context';
import { lineUrls } from '../line-page/line-urls';
import { selectLineHistory } from './select-line-history';

/**
 * The buy history of one line, on a page of its own (velista `0135`, section 5).
 *
 * It was two cards on the line page, each growing page by page, and together they
 * took most of that page. Here they are one list with two scopes, three figures
 * over it, and the months as its headings.
 *
 * **Each row names the product that was bought**, which the old rows did not,
 * though every settlement holds it. On a line with three products that is the
 * difference between a history and a count.
 */
@Component({
  selector: 'lib-line-history-page',
  imports: [RokuTranslatorPipe, PageHeader],
  templateUrl: './line-history-page.html',
  styleUrl: './line-history-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineHistoryPage {
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _zones = inject(ZoneStore);
  private readonly _names = inject(MemberNames);
  private readonly _itemNames = inject(ItemNames);
  private readonly _session = inject(SessionStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _urls = lineUrls();

  /** Which purchases are on screen. This list first: it is the line's own. */
  readonly scope = signal<HistoryScope>('thisList');

  /** An older page is being read, so the control waits. */
  readonly loadingMore = signal(false);

  private readonly _line = computed(() =>
    this._lines
      .linesIn(this._urls.listId())
      .find((line) => line.id === this._urls.lineId())
  );

  readonly status = computed(() =>
    linePageStatus(this._lines, this._urls.listId(), this._urls.lineId())
  );

  readonly history = computed(() => {
    const line = this._line();
    const lineId = this._urls.lineId();
    const zoneId = this._urls.zoneId();
    const everywhere = this.scope() === 'everywhere';

    return selectLineHistory({
      line,
      listName:
        this._lists
          .listsIn(zoneId)
          .find((list) => list.id === this._urls.listId())?.name ?? null,
      scope: this.scope(),
      settlements: everywhere
        ? this._lines.itemSettlementsOf(lineId)
        : this._lines.settlementsOf(lineId),
      hasMore: everywhere
        ? this._lines.hasMoreItemSettlements(lineId)
        : this._lines.hasMoreSettlements(lineId),
      itemNameOf: (itemId) => this._itemNames.nameOf(itemId),
      pricesOf: this._itemNames.pricesOf,
      nameOf: (userId) => this._names.nameOf(zoneId, userId),
      listNameOf: (listId) => this._listNameOf(listId),
      callerUserId: this._session.userId(),
      locale: this._locale(),
      now: new Date(),
    });
  });

  constructor() {
    loadLineContext(this._urls.zoneId, this._urls.listId);

    // The line's own history needs only its id.
    effect(() => {
      const lineId = this._urls.lineId();
      untracked(() => void this._lines.loadSettlements(lineId));
    });

    // The products the rows name. A purchase can name a product the line no longer
    // holds, so the names are asked for from the rows and not from the line.
    effect(() => {
      const lineId = this._urls.lineId();
      const itemIds = [
        ...(this._lines.settlementsOf(lineId) ?? []),
        ...(this._lines.itemSettlementsOf(lineId) ?? []),
      ]
        .map((settlement) => settlement.itemId)
        .filter((itemId): itemId is string => itemId !== null)
        // And the line's own, for the name the title draws (velista `0144`).
        .concat(this._line()?.itemIds ?? []);
      if (itemIds.length > 0) {
        untracked(() => void this._itemNames.ensure([...new Set(itemIds)]));
      }
    });
  }

  /** The other scope. "Everywhere" is read the first time somebody asks for it. */
  choose(scope: HistoryScope): void {
    this.scope.set(scope);
    const line = this._line();
    if (
      scope === 'everywhere' &&
      line !== undefined &&
      this._lines.itemSettlementsOf(line.id) === undefined
    ) {
      void this._lines.loadItemSettlements(line);
    }
  }

  /** An older page of the scope on screen, appended (velista plan 0047, section 4). */
  async older(): Promise<void> {
    const line = this._line();
    if (line === undefined || this.loadingMore()) {
      return;
    }

    this.loadingMore.set(true);
    if (this.scope() === 'everywhere') {
      await this._lines.loadMoreItemSettlements(line);
    } else {
      await this._lines.loadMoreSettlements(line.id);
    }
    this.loadingMore.set(false);
  }

  /** Back to the line, which is where this page is always opened from. */
  async back(): Promise<void> {
    await this._pages.back(this._urls.line());
  }

  /**
   * Which list a purchase was on, for the "everywhere" scope. Searched across the
   * groups the store holds. Null for a list whose name is not cached, which the
   * row then leaves out.
   */
  private _listNameOf(listId: string): string | null {
    for (const zone of this._zones.myZones()) {
      const found = this._lists
        .listsIn(zone.id)
        .find((list) => list.id === listId);
      if (found !== undefined) {
        return found.name;
      }
    }
    return null;
  }
}
