import {
  computed,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { filter } from 'rxjs';
import { appPath } from '../app-path';
import { TourAnchors } from './tour-anchors';
import {
  planTour,
  type PlannedStop,
  type TourHoldings,
  type TourPlacement,
} from './tour-stops';

/**
 * How long a stop waits for its control to appear before it is dropped (section 5).
 *
 * Long enough for a screen that draws its control after a read (the groups section
 * after the zones arrive, a list's composer after the list does), short enough that a
 * control which is not coming does not leave a dimmed screen with nothing lit.
 */
export const TOUR_ANCHOR_WAIT_MS = 4000;

/** How long a run waits to learn what the account holds before it plans without. */
export const TOUR_HOLDINGS_WAIT_MS = 4000;

/** What an account that has not been read yet is taken to hold: nothing. */
const HOLDS_NOTHING: TourHoldings = { hasGroup: false, firstList: null };

/** What `AppLayout` needs to draw one card. */
export interface TourCardView {
  readonly stopId: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** This card's position, from 1. */
  readonly n: number;
  /** How many cards the run planned. Fixed when it starts (section 3). */
  readonly total: number;
  /** Whether this is the last card, which says Finish instead of Next. */
  readonly last: boolean;
  readonly placement: TourPlacement;
  /** The control being lit. */
  readonly element: HTMLElement;
}

interface Run {
  readonly id: number;
  /** Empty while the run is still finding out what the account holds. */
  readonly stops: readonly PlannedStop[];
}

/**
 * The tour's state, and the thing that drives the app through it (velista `0099`).
 *
 * ## Why it lives in `platform`
 *
 * It navigates, so it reads the router, and rule D1 keeps every router read out of
 * `ui`. `AppLayout` draws what {@link card} says, which is `NavChrome`'s arrangement.
 * It may not reach the API either, so ending a run flips {@link seen} and bumps
 * {@link ended}, and `app-providers.ts` sends the write from an effect on that.
 *
 * ## Why it is not root scoped
 *
 * It builds URLs from the locale and the mount, and both are provided by the app, one
 * level below the root under the shell (rule D5). `VELISTA_PLATFORM_PROVIDERS` names
 * it. The anchors are apart, in `TourAnchors`, so the attribute needs none of this.
 *
 * ## The stops are settled once
 *
 * {@link start} plans the run from what the account holds and never changes the plan.
 * A stop whose control does not appear is skipped when it comes up, and the total on
 * the cards stays what it was: a card may say "4 of 5" and be followed by the end,
 * which is cheaper than a card floating over a screen with nothing lit (section 5).
 */
@Injectable()
export class TourStore {
  private readonly _router = inject(Router);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _anchors = inject(TourAnchors);

  private readonly _holdings = signal<TourHoldings | null>(null);
  private readonly _holdingsWaiting = new Set<(held: TourHoldings) => void>();
  private readonly _run = signal<Run | null>(null);
  private readonly _index = signal<number | null>(null);
  private readonly _seen = signal(false);
  private readonly _ended = signal(0);

  /** Bumped by every start and every end, so a step still awaiting learns it is stale. */
  private _generation = 0;

  /** Whether a run is going, card or no card. The screen is dimmed and inert while so. */
  readonly running: Signal<boolean> = computed(() => this._run() !== null);

  /** The card to draw, or null while there is none (between stops, or no run). */
  readonly card: Signal<TourCardView | null> = computed(() => {
    const run = this._run();
    const index = this._index();
    if (run === null || index === null) {
      return null;
    }

    const planned = run.stops[index];
    const element =
      planned === undefined
        ? undefined
        : this._anchors.elements().get(planned.stop.anchor);
    if (planned === undefined || element === undefined) {
      return null;
    }

    return {
      stopId: planned.stop.id,
      titleKey: planned.stop.titleKey,
      bodyKey: planned.stop.bodyKey,
      n: index + 1,
      total: run.stops.length,
      last: index === run.stops.length - 1,
      placement: planned.stop.placement,
      element,
    };
  });

  /**
   * Whether the account has been through the tour.
   *
   * Seeded from `appState.tourSeenAt` by `app-providers.ts`, and flipped here on the
   * tick a run ends, before any write has been answered.
   */
  readonly seen: Signal<boolean> = this._seen.asReadonly();

  /** How many runs have ended in this document. The app layer writes on a change. */
  readonly ended: Signal<number> = this._ended.asReadonly();

  constructor() {
    // Back ends the run (section 6). A tour is not a history entry, so the pop is left
    // to happen and the cards come off the screen that changed underneath them.
    // Nothing unsubscribes, for `NavChrome`'s reason: the router outlives this.
    this._router.events
      .pipe(
        filter(
          (event): event is NavigationStart =>
            event instanceof NavigationStart &&
            event.navigationTrigger === 'popstate'
        )
      )
      .subscribe(() => this._end(false));
  }

  /**
   * Say what the account holds, or null while it is not known.
   *
   * Called from the app layer only, which reads it from the zone store.
   */
  setHoldings(holdings: TourHoldings | null): void {
    this._holdings.set(holdings);
    if (holdings === null) {
      return;
    }

    const waiting = [...this._holdingsWaiting];
    this._holdingsWaiting.clear();
    waiting.forEach((resolve) => resolve(holdings));
  }

  /** Say whether the server has the tour as seen. Called from the app layer only. */
  setSeen(seen: boolean): void {
    // A run that ended here is seen whatever an older copy of the server says: the
    // write may still be on its way.
    this._seen.set(seen || this._ended() > 0);
  }

  /**
   * Go home and play the tour from its first stop.
   *
   * The same call from the setup's last screen and from the account row (sections 7
   * and 8). A second call while a run is going does nothing.
   */
  async start(): Promise<void> {
    if (this._run() !== null) {
      return;
    }

    const generation = ++this._generation;
    this._run.set({ id: generation, stops: [] });
    this._index.set(null);

    await this._go(['home']);
    const holdings = await this._holdingsWithin(TOUR_HOLDINGS_WAIT_MS);
    if (generation !== this._generation) {
      return;
    }

    this._run.set({ id: generation, stops: planTour(holdings) });
    await this._show(generation, 0);
  }

  /** The Next button. On the last card it is Finish. */
  next(): void {
    const index = this._index();
    const run = this._run();
    if (run === null || index === null) {
      return;
    }

    if (index >= run.stops.length - 1) {
      this.finish();
      return;
    }

    void this._show(run.id, index + 1);
  }

  /** Finish, on the last card. */
  finish(): void {
    this._end(true);
  }

  /** Skip the tour, on any card, and Escape. */
  skip(): void {
    this._end(true);
  }

  /**
   * Show the stop at `from`, or the first one after it whose control appears.
   *
   * The card comes off while the app moves, so no card is ever drawn over the screen
   * it was not written for. The dimming stays, because {@link running} does.
   */
  private async _show(generation: number, from: number): Promise<void> {
    this._index.set(null);
    this._anchors.light(null);

    const stops = this._run()?.stops ?? [];
    for (let index = from; index < stops.length; index += 1) {
      const planned = stops[index];
      if (planned === undefined) {
        break;
      }

      await this._go(planned.route);
      if (generation !== this._generation) {
        return;
      }

      const element = await this._anchors.whenRegistered(
        planned.stop.anchor,
        TOUR_ANCHOR_WAIT_MS
      );
      if (generation !== this._generation) {
        return;
      }

      if (element === null) {
        console.warn(
          `[tour] stop "${planned.stop.id}" was dropped: nothing declared "${planned.stop.anchor}" in time.`
        );
        continue;
      }

      element.scrollIntoView?.({ block: 'nearest' });
      this._anchors.light(planned.stop.anchor);
      this._index.set(index);
      return;
    }

    this._end(true);
  }

  /**
   * End the run, mark it seen, and say so once.
   *
   * `toHome` is false for the back button only: the pop is already under way, and a
   * navigation of this store's own would fight it.
   */
  private _end(toHome: boolean): void {
    if (this._run() === null) {
      return;
    }

    this._generation += 1;
    this._run.set(null);
    this._index.set(null);
    // Read again for the next run, which may be a replay after a group was made.
    this._holdings.set(null);
    this._anchors.light(null);
    this._seen.set(true);
    this._ended.update((count) => count + 1);

    if (toHome) {
      void this._go(['home']);
    }
  }

  /**
   * Navigate inside the app, **replacing** the entry (section 6).
   *
   * Every navigation the tour makes replaces rather than pushes, so the back button
   * after a run never walks back through its stops.
   */
  private async _go(segments: readonly string[]): Promise<void> {
    await this._router.navigateByUrl(
      appPath(this._locale(), this._basePath, ...segments),
      { replaceUrl: true }
    );
  }

  /** What the account holds, as soon as it is known, or nothing after `withinMs`. */
  private _holdingsWithin(withinMs: number): Promise<TourHoldings> {
    const held = this._holdings();
    if (held !== null) {
      return Promise.resolve(held);
    }

    return new Promise((resolve) => {
      const done = (holdings: TourHoldings): void => {
        clearTimeout(timer);
        this._holdingsWaiting.delete(done);
        resolve(holdings);
      };
      const timer = setTimeout(() => done(HOLDS_NOTHING), withinMs);
      this._holdingsWaiting.add(done);
    });
  }
}
