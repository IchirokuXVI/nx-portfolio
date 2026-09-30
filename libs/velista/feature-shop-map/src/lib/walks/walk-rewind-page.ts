import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  foldWalk,
  walkTimeline,
  type WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  ShopDetailStore,
  ShopWalksStore,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  REWIND_STEP_MS,
  rewindPreviewDocument,
  shopWalkHistory,
  walkLogEnd,
  walkWallClock,
} from '@portfolio/velista/models';
import {
  locationIdOf,
  PageNavigation,
  shopWalkPath,
  walkIdOf,
} from '@portfolio/velista/platform';
import { CloseIcon, SpinnerIcon } from '@portfolio/velista/ui';
import { ShopMapView } from '../shop-map-view/shop-map-view';
import { historyRowView, type WalkPhrase } from './walk-history-page';
import { clockText, dayName, shopLine, spanOf } from './walk-text';

/** One entry's tick on the slider, as a share of the track. */
export interface RewindMarker {
  readonly id: string;
  readonly percent: number;
}

/** A button that jumps to an entry. */
export interface RewindJump {
  readonly id: string;
  readonly logMs: number;
  readonly time: string;
  readonly title: WalkPhrase;
}

/** What "Continue from here" last came to, for the line above it. */
export type RewindNotice = 'changed' | 'failed' | null;

/**
 * Rewind (velista `0122`, target 4; the `Rewind` board): the walk's map at a
 * chosen moment with what came after it faded, the moment in large type, a
 * slider over the whole log in 15 s steps with a tick for every entry, buttons
 * that jump to an entry, and "Continue from here".
 *
 * ## Folded on the phone
 *
 * The log is read whole (`fromSeq=0`: `stateAt` takes no starting document) and
 * folded here with `stateAt`, and the canvas draws it in the mapper look with
 * `setFadedAfter`. So moving the slider costs no request, and the slider reaches
 * past an earlier rewind like any other moment: the log keeps everything.
 *
 * ## Continuing is one more entry
 *
 * "Continue from here" appends a `rewound` entry on the `lastSeq` the log was read
 * with. The history is never edited. Another phone saving first answers
 * `walk_changed`, and the page reads the walk again and says so.
 *
 * `shops/:locationId/walks/:walkId/rewind`, only with `shopMap.record`.
 */
@Component({
  selector: 'lib-walk-rewind-page',
  imports: [CloseIcon, RokuTranslatorPipe, ShopMapView, SpinnerIcon],
  templateUrl: './walk-rewind-page.html',
  styleUrl: './walk-rewind-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalkRewindPage {
  private readonly _walks = inject(ShopWalksStore);
  private readonly _shops = inject(ShopDetailStore);
  private readonly _pages = inject(PageNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;

  protected readonly step = REWIND_STEP_MS;
  protected readonly locationId = locationIdOf(this._route);
  protected readonly walkId = walkIdOf(this._route);

  protected readonly read = computed(() => this._walks.log(this.walkId()));

  protected readonly entries = computed<readonly WalkEntry[]>(() => {
    const read = this.read();
    return read.kind === 'log' ? read.log.entries : [];
  });

  protected readonly name = computed(
    () => this._walks.summary(this.walkId())?.name ?? null
  );

  protected readonly subtitle = computed(() => {
    const read = this._shops.read(this.locationId());
    return read.kind === 'shop' ? shopLine(read.shop, this._locale()) : null;
  });

  /** The end of the log, which is now. */
  protected readonly end = computed(() => walkLogEnd(this.entries()));

  /** The slider's top, a whole number of steps at or above the end. */
  protected readonly top = computed(
    () => Math.ceil(this.end() / REWIND_STEP_MS) * REWIND_STEP_MS
  );

  /** The moment chosen, or null for now. */
  private readonly _chosen = signal<number | null>(null);

  protected readonly at = computed(() => {
    const chosen = this._chosen();
    return chosen === null ? this.end() : Math.min(chosen, this.end());
  });

  protected readonly atEnd = computed(() => this.at() >= this.end());

  protected readonly document = computed(() => {
    const entries = this.entries();
    return this.atEnd()
      ? foldWalk(entries)
      : rewindPreviewDocument(entries, this.at());
  });

  protected readonly faded = computed(() =>
    this.atEnd() ? null : { logMs: this.at(), log: this.entries() }
  );

  protected readonly moment = computed(() => {
    const entries = this.entries();
    const wall = walkWallClock(entries, this.at());
    const start = walkWallClock(entries, 0);
    if (wall === null || start === null) {
      return null;
    }
    const locale = this._locale();
    return {
      day: dayName(wall, locale),
      time: clockText(wall, locale, true),
      since: spanOf(this.at()),
      start: clockText(start, locale),
      end: clockText(walkWallClock(entries, this.end()) ?? wall, locale),
    };
  });

  protected readonly markers = computed<RewindMarker[]>(() => {
    const top = this.top();
    return top === 0
      ? []
      : walkTimeline(this.entries()).map((marker) => ({
          id: marker.id,
          percent: (marker.logMs / top) * 100,
        }));
  });

  /** One button per history row, oldest first, as the slider reads left to right. */
  protected readonly jumps = computed<RewindJump[]>(() => {
    const entries = this.entries();
    const locale = this._locale();
    const events = new Map(entries.map((entry) => [entry.id, entry]));
    return shopWalkHistory(entries, events)
      .reverse()
      .map((row) => {
        const view = historyRowView(row, locale, false);
        return {
          id: row.id,
          logMs: row.logMs,
          time: view.time,
          title: view.title,
        };
      });
  });

  protected readonly busy = signal(false);
  protected readonly notice = signal<RewindNotice>(null);

  constructor() {
    effect(() => {
      const walkId = this.walkId();
      const locationId = this.locationId();
      if (walkId === '') {
        return;
      }
      untracked(() => {
        void this._walks.loadLog(walkId);
        if (this._walks.summary(walkId) === null) {
          void this._walks.loadWalk(walkId);
        }
        if (locationId !== '') {
          void this._shops.ensure(locationId);
        }
      });
    });
  }

  protected onSlide(event: Event): void {
    this._chosen.set(Number((event.target as HTMLInputElement).value));
    this.notice.set(null);
  }

  protected jump(logMs: number): void {
    this._chosen.set(logMs);
    this.notice.set(null);
  }

  async continueHere(): Promise<void> {
    if (this.busy() || this.atEnd()) {
      return;
    }
    this.busy.set(true);
    this.notice.set(null);
    try {
      const outcome = await this._walks.rewind(this.walkId(), this.at());
      if (outcome.state === 'rewound') {
        await this.close();
        return;
      }
      this.notice.set(outcome.state === 'changed' ? 'changed' : 'failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected retry(): void {
    void this._walks.loadLog(this.walkId());
  }

  /** Back to the history this was opened from. */
  close(): Promise<void> {
    return this._pages.back(
      shopWalkPath(
        this._locale(),
        this._basePath,
        this.locationId(),
        this.walkId()
      )
    );
  }
}
