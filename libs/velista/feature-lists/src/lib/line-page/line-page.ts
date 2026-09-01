import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  catalogItemById,
  LineStore,
  ListStore,
  MemberNames,
  SessionStore,
  ZoneStore,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  zoneIdOf,
} from '@portfolio/velista/platform';
import { ChevronLeftIcon } from '@portfolio/velista/ui';
import { selectLinePage } from './select-line-page';

/**
 * Everything the app knows about one line (velista plan 0043, section 5.3).
 *
 * ## Its own route, and why that is the point
 *
 * A page rather than a deeper sheet, so it can be linked to and reached from a search
 * later. The detail sheet answers the question you have standing in the kitchen; this
 * answers everything else, and the two are different screens because they are read at
 * different moments.
 *
 * ## Two histories, side by side and labelled
 *
 * "On this list" is every settlement of this line: one household's consumption. "**
 * Everywhere you shop**" is every settlement of this line's products, across the zones
 * the reader can see: theirs. They are separate because they answer different
 * questions, and a single merged number would be neither.
 *
 * The second is **absent rather than empty** on a line with no products, and that is
 * not a rendering nicety: it is keyed on the product set, so a free text line cannot
 * have one, and drawing it empty would tell somebody they have never bought this
 * anywhere when nobody has yet said what "this" is. Which is the argument for the
 * composer's suggestions, and the reason this page has a place to attach one.
 *
 * ## What it does not draw
 *
 * Prices, and where to buy it. The region exists and says so, because the backend's
 * backlog `0004` is what fills it and with one chain harvested it would show one price
 * at one shop (section 9).
 */
@Component({
  selector: 'lib-line-page',
  imports: [RokuTranslatorPipe, DatePipe, ChevronLeftIcon],
  templateUrl: './line-page.html',
  styleUrl: './line-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinePage {
  private readonly _lines = inject(LineStore);
  private readonly _lists = inject(ListStore);
  private readonly _zones = inject(ZoneStore);
  private readonly _names = inject(MemberNames);
  private readonly _session = inject(SessionStore);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _localeStore = inject(RokuLocaleStore);
  private readonly _basePath = inject(APP_BASE_PATH);

  readonly zoneId = zoneIdOf(this._route);
  readonly listId = listIdOf(this._route);
  readonly lineId = lineIdOf(this._route);

  readonly busy = signal(false);

  /**
   * Both histories, each asked for on its own.
   *
   * Two effects rather than one, because they arrive independently and the page is
   * useful with either: the per line history needs only the line, and the cross list
   * one needs its products first. A page that waited for both would show nothing while
   * the half it already had sat ready.
   */
  private readonly _loadOwn = effect(() => {
    const lineId = this.lineId();
    untracked(() => void this._lines.loadSettlements(lineId));
  });

  private readonly _loadItems = effect(() => {
    const line = this._line();
    if (line !== undefined) {
      untracked(() => void this._lines.loadItemSettlements(line));
    }
  });

  private readonly _line = computed(() =>
    this._lines.linesIn(this.listId()).find((line) => line.id === this.lineId())
  );

  private readonly _permissions = computed(
    () =>
      this._lists
        .listsIn(this.zoneId())
        .find((list) => list.id === this.listId())?.myPermissions ?? []
  );

  readonly page = computed(() => {
    const line = this._line();
    const zoneId = this.zoneId();

    return selectLinePage({
      line,
      list: this._lists
        .listsIn(zoneId)
        .find((list) => list.id === this.listId()),
      zoneName: this._zones.zoneById(zoneId)?.name ?? null,
      settlements: this._lines.settlementsOf(this.lineId()),
      itemSettlements: this._lines.itemSettlementsOf(this.lineId()),
      itemNameOf: (itemId) => catalogItemById(itemId),
      nameOf: (userId) => this._names.nameOf(zoneId, userId),
      listNameOf: (listId) => this._listNameOf(listId),
      callerUserId: this._session.userId(),
      locale: this._localeStore.locale(),
      alsoOn: this._alsoOn(),
      // `WRITE` on an unapproved line, `MANAGE` on anything, which is the same rule
      // the edit sheet follows: a writer whose line has been agreed to cannot quietly
      // change what was agreed to (backend plan 0036, section 4.1).
      canEdit: this._canEdit(),
      canDelete: this._canEdit(),
      busy: this.busy(),
    });
  });

  private _canEdit(): boolean {
    const permissions = this._permissions();
    const line = this._line();
    return (
      permissions.includes('MANAGE') ||
      (permissions.includes('WRITE') && line?.approvalStatus !== 'APPROVED')
    );
  }

  /**
   * Which list a settlement was on, for the cross list section.
   *
   * Searched across every zone the store holds, because a settlement in that section
   * can come from any of them: that is what makes it the reader's history rather than
   * this household's. Null for a list whose name is not cached, which the row draws as
   * nothing rather than as an id.
   */
  private _listNameOf(listId: string): string | null {
    for (const zone of this._zones.zones()) {
      const found = this._lists
        .listsIn(zone.id)
        .find((list) => list.id === listId);
      if (found !== undefined) {
        return found.name;
      }
    }
    return null;
  }

  /**
   * The reader's other lists carrying this line's products.
   *
   * Computed from what the client already holds rather than from a request, and that
   * is the honest scope of it: there is no endpoint that answers "which of my lists
   * carry this item", so this reports the lists whose lines this session has actually
   * loaded. It **under reports** by design, exactly as presence does, which is why the
   * section draws nothing when it is empty rather than claiming there are none
   * (section 5.3).
   *
   * Matched on the product set, so it finds a line carrying the same thing under a
   * different name, which is the whole reason a line has products at all.
   */
  private _alsoOn(): readonly string[] {
    const line = this._line();
    if (line === undefined || line.itemIds.length === 0) {
      return [];
    }

    const wanted = new Set(line.itemIds);
    const found: string[] = [];

    for (const zone of this._zones.zones()) {
      for (const list of this._lists.listsIn(zone.id)) {
        if (list.id === this.listId()) {
          continue;
        }
        const carries = this._lines
          .linesIn(list.id)
          .some((other) => other.itemIds.some((id) => wanted.has(id)));
        if (carries) {
          found.push(`${zone.name} · ${list.name}`);
        }
      }
    }

    return found;
  }

  /** Take one product off the line. An ordinary edit: the set is rewritten whole. */
  async removeProduct(itemId: string): Promise<void> {
    const line = this._line();
    if (line === undefined || this.busy()) {
      return;
    }

    this.busy.set(true);
    await this._lines.updateLine(line.id, {
      itemIds: line.itemIds.filter((id) => id !== itemId),
    });
    this.busy.set(false);
  }

  /** Delete, behind a confirmation, which is the only thing that discards a history. */
  async confirmDelete(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(
        this._localeStore.locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId(),
        'lines',
        this.lineId(),
        'confirm',
        'delete'
      )
    );
  }

  async back(): Promise<void> {
    await this._router.navigateByUrl(
      appPath(
        this._localeStore.locale(),
        this._basePath,
        'zones',
        this.zoneId(),
        'lists',
        this.listId()
      )
    );
  }
}
