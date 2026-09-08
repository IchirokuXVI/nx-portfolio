import {
  computed,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import {
  NavigationEnd,
  Router,
  type ActivatedRouteSnapshot,
} from '@angular/router';
import { filter } from 'rxjs';
import { BackendReadiness } from './backend-readiness';

/**
 * Route `data` flag naming a route that may draw before the backend has answered
 * (plan 0071 D4).
 *
 * Exactly one route carries it: velista's landing page. It is the front door and the
 * URL a home screen shortcut is installed against, so holding it back would put a
 * waiting screen in front of the thing that must appear at once. Every other screen in
 * this app needs the backend to say something before it can show anything true.
 *
 * A constant rather than a written string, so the route table and the gate cannot name
 * two different keys.
 */
export const RENDERS_WHILE_CONNECTING = 'rendersWhileConnecting';

/**
 * Whether the app may draw the page it is on yet.
 *
 * ## Why this is a service, and why it is here
 *
 * `AppLayout` asks the question, and `AppLayout` lives in `ui`, which may not inject
 * `Router` (rule D1, and `layering.spec.ts` enforces it): navigating is choosing where
 * the app goes, and that is a container's call. Reading which route the app is *on* is
 * a different act, but the rule is a blanket one and worth keeping blanket, so the
 * reading happens here instead, beside `SHEET_SEGMENT` and `sheetFallGuard`, which are
 * in this library for the same reason.
 *
 * The route data is read from the router rather than passed down because `AppLayout`
 * is the parent of every page, and no page can tell its parent anything before it has
 * been created.
 *
 * ## The gate opens once and does not close
 *
 * `BackendReadiness.wasReady()` and not `state() === 'ready'`. Losing the connection
 * halfway through a session moves the state back to `unreachable`, and a gate that
 * closed on that would destroy the live page and whatever was typed into it. Section
 * 5.3 of the plan says that case is unchanged, and it is: `lib-connection-lost` covers
 * a page that is still there.
 *
 * `too-old` opens it too, and it is the one answer that is not about reaching the
 * backend at all. The app has an answer, it is simply a refusal, and holding the word
 * Connecting in front of somebody whose build the deployment will not serve says a
 * thing that is not true. The screen that says the true thing is `0072`; until then the
 * app runs on what it has, which is what it did before this plan.
 */
@Injectable({ providedIn: 'root' })
export class StartupGate {
  private readonly _router = inject(Router);
  private readonly _readiness = inject(BackendReadiness);

  /**
   * Whether the route now activated says it can be drawn while connecting.
   *
   * Seeded from the current snapshot rather than left false until the first
   * `NavigationEnd`: the initial navigation can complete before anything injects this,
   * in which case no event is coming and the front door would wait for a backend it is
   * meant not to wait for.
   */
  private readonly _rendersWhileConnecting = signal(
    readsFlag(this._router.routerState.snapshot.root)
  );

  /**
   * True when the outlet may exist.
   *
   * **The cover holds the outlet rather than sitting over it** (D3). An overlay drawn
   * over a live outlet leaves the page below constructed, so its resolvers run and its
   * requests go out on behalf of somebody who has just been told to wait.
   */
  readonly rendersNow: Signal<boolean> = computed(() => {
    const state = this._readiness.state();

    return (
      this._readiness.wasReady() ||
      state === 'too-old' ||
      (state === 'connecting' && this._rendersWhileConnecting())
    );
  });

  constructor() {
    // Every completed navigation, because which route is deepest is exactly what
    // changes on one. Nothing unsubscribes: the router outlives this service in both
    // run modes, and `@angular/core/rxjs-interop` is not available to anything in this
    // app, so `takeUntilDestroyed` is not an option here anyway.
    this._router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() =>
        this._rendersWhileConnecting.set(
          readsFlag(this._router.routerState.snapshot.root)
        )
      );
  }
}

/**
 * Whether the deepest activated route carries the flag.
 *
 * The **deepest** one, because the flag is a statement about the screen that will be
 * drawn, and the route that draws it is the leaf. Angular's `emptyOnly` data
 * inheritance has already decided what that leaf's `data` contains by the time this
 * reads it, which is what keeps the flag on landing from reaching the two entry sheets
 * below it: both carry their own `data`, so neither inherits it, and a deep link into
 * one waits like every other screen. That is right, because those screens create a
 * group.
 */
function readsFlag(from: ActivatedRouteSnapshot): boolean {
  let deepest = from;
  while (deepest.firstChild !== null) {
    deepest = deepest.firstChild;
  }

  return deepest.data[RENDERS_WHILE_CONNECTING] === true;
}
