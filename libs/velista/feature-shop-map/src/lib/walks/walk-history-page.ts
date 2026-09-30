import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import type { WalkEntry } from '@portfolio/luna-shopper/shop-map/model';
import { ShopWalksStore } from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  shopWalkHistory,
  type ShopWalkHistoryRow,
} from '@portfolio/velista/models';
import {
  locationIdOf,
  PageNavigation,
  sheetSegments,
  SHOP_PATHS,
  shopWalkPath,
  shopWalksPath,
  WALK_SENSORS,
  walkIdOf,
} from '@portfolio/velista/platform';
import { ChevronLeftIcon, EllipsisIcon } from '@portfolio/velista/ui';
import {
  clockText,
  dayKey,
  dayName,
  minutesOf,
  type DayName,
} from './walk-text';

/** A phrase: a key and what it interpolates. */
export interface WalkPhrase {
  readonly key: string;
  readonly values: Readonly<Record<string, string | number>>;
}

/** One row as the history draws it. */
export interface WalkHistoryRowView {
  readonly id: string;
  readonly time: string;
  readonly title: WalkPhrase;
  /** The detail line, its parts joined with a middle dot. May be empty. */
  readonly details: readonly WalkPhrase[];
  readonly latest: boolean;
}

/** One day of the history, newest first. */
export interface WalkHistoryDay {
  readonly key: string;
  readonly name: DayName;
  readonly rows: readonly WalkHistoryRowView[];
}

const phrase = (
  key: string,
  values: Record<string, string | number> = {}
): WalkPhrase => ({ key, values });

/**
 * The words of one history row (velista `0122`, target 3). Pure, so the spec
 * reads every kind without a page.
 */
export function historyRowView(
  row: ShopWalkHistoryRow,
  locale: string,
  latest: boolean
): WalkHistoryRowView {
  const time = clockText(row.at, locale);
  const details: WalkPhrase[] = [];
  let title: WalkPhrase;

  switch (row.kind) {
    case 'started':
    case 'resumed':
      title = phrase(`shopWalks.history.${row.kind}`);
      details.push(
        phrase('shopWalks.history.walked', {
          count: minutesOf(row.walkedMs ?? 0),
        })
      );
      if (row.marks !== null) {
        details.push(phrase('shopWalks.list.marks', { count: row.marks }));
      }
      if (row.checked) {
        details.push(phrase('shopWalks.history.checked'));
      }
      break;
    case 'problem':
      title = phrase(
        row.reason === 'frame-moved'
          ? 'shopWalks.history.frameMoved'
          : 'shopWalks.history.trackingLost'
      );
      details.push(phrase('shopWalks.history.keptUntil', { time }));
      if (row.discarded) {
        details.push(phrase('shopWalks.history.purpleDiscarded'));
      }
      break;
    case 'edited':
      title = phrase('shopWalks.history.edited');
      if (row.changes !== null && row.changes.areas > 0) {
        details.push(
          phrase('shopWalks.history.areasChanged', {
            count: row.changes.areas,
          })
        );
      }
      if (row.changes !== null && row.changes.marks > 0) {
        details.push(
          phrase('shopWalks.history.marksChanged', {
            count: row.changes.marks,
          })
        );
      }
      break;
    case 'rewound':
      title = phrase('shopWalks.history.rewound', {
        time: row.rewoundTo === null ? '' : clockText(row.rewoundTo, locale),
      });
      if (row.undoes !== null) {
        details.push(
          phrase('shopWalks.history.undoes', {
            time: clockText(row.undoes, locale),
          })
        );
      } else if (row.beforeProblem) {
        details.push(phrase('shopWalks.history.beforeProblem'));
      }
      break;
    default:
      title = phrase(`shopWalks.history.${row.kind}`);
  }

  return { id: row.id, time, title, details, latest };
}

/** The rows grouped by the day they happened, newest day first. */
export function historyDays(
  rows: readonly ShopWalkHistoryRow[],
  locale: string,
  now = new Date()
): WalkHistoryDay[] {
  const days: WalkHistoryDay[] = [];
  rows.forEach((row, index) => {
    const key = dayKey(row.at);
    const view = historyRowView(row, locale, index === 0);
    const last = days[days.length - 1];
    if (last !== undefined && last.key === key) {
      days[days.length - 1] = { ...last, rows: [...last.rows, view] };
    } else {
      days.push({ key, name: dayName(row.at, locale, now), rows: [view] });
    }
  });
  return days;
}

/**
 * A walk's history (velista `0122`, target 3; the `History` board): the walk's
 * name with "History" under it, Rewind, and every entry newest first, grouped by
 * day, with the newest marked "Latest". A walking session is one row, however
 * many 20 s saves it made (see `shopWalkHistory`).
 *
 * Edit map opens the edit page of velista `0123` (`walks/:walkId/edit`). Resume
 * walking opens the recording page of velista `0126` (`walks/:walkId/record`),
 * through the warning over this page when the walk is shown. Where the browser
 * has no camera tracking (`immersive-ar`) it is absent, and one line says why.
 *
 * `shops/:locationId/walks/:walkId`, only with `shopMap.record`.
 */
@Component({
  selector: 'lib-walk-history-page',
  imports: [ChevronLeftIcon, EllipsisIcon, RokuTranslatorPipe, RouterOutlet],
  templateUrl: './walk-history-page.html',
  styleUrl: './walk-history-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalkHistoryPage {
  private readonly _walks = inject(ShopWalksStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly locationId = locationIdOf(this._route);
  protected readonly walkId = walkIdOf(this._route);

  protected readonly read = computed(() => this._walks.walk(this.walkId()));

  /** Whether this browser can record: null until it answered. */
  protected readonly canRecord = signal<boolean | null>(null);

  protected readonly name = computed(() => {
    const read = this.read();
    return read.kind === 'walk'
      ? read.detail.walk.name
      : (this._walks.summary(this.walkId())?.name ?? null);
  });

  /** The log's events by entry id, once read, for the counts of the rows. */
  private readonly _events = computed<ReadonlyMap<string, WalkEntry> | null>(
    () => {
      const log = this._walks.log(this.walkId());
      return log.kind === 'log'
        ? new Map(log.log.entries.map((entry) => [entry.id, entry]))
        : null;
    }
  );

  protected readonly days = computed(() => {
    const read = this.read();
    return read.kind === 'walk'
      ? historyDays(
          shopWalkHistory(read.detail.timeline, this._events()),
          this._locale()
        )
      : [];
  });

  constructor() {
    void inject(WALK_SENSORS)
      .supported()
      .then((yes) => this.canRecord.set(yes));

    effect(() => {
      const walkId = this.walkId();
      if (walkId === '') {
        return;
      }
      untracked(() => {
        void this._walks.loadWalk(walkId);
        void this._walks.loadLog(walkId);
      });
    });
  }

  protected rewind(): void {
    void this._router.navigateByUrl(this._path('rewind'));
  }

  /** Edit map: change the map by hand, without walking (velista `0123`). */
  protected editMap(): void {
    void this._router.navigateByUrl(this._path('edit'));
  }

  /**
   * Resume walking (velista `0126`): the warning first when shoppers see this
   * walk, since every save while walking changes their map.
   */
  protected resume(): void {
    const read = this.read();
    if (read.kind === 'walk' && read.detail.walk.shown) {
      void this._router.navigate(sheetSegments(SHOP_PATHS.resume), {
        relativeTo: this._route,
      });
      return;
    }
    void this._router.navigateByUrl(this._path('record'));
  }

  protected openSettings(): void {
    void this._router.navigateByUrl(this._path('settings'));
  }

  protected retry(): void {
    void this._walks.loadWalk(this.walkId());
    void this._walks.loadLog(this.walkId());
  }

  protected back(): Promise<void> {
    return this._pages.back(
      shopWalksPath(this._locale(), this._basePath, this.locationId())
    );
  }

  private _path(page: 'rewind' | 'settings' | 'edit' | 'record'): string {
    return shopWalkPath(
      this._locale(),
      this._basePath,
      this.locationId(),
      this.walkId(),
      page
    );
  }
}
