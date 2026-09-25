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
import { SHEET_SEGMENT } from './sheet-path';

/**
 * Route `data` key naming a screen the bottom bar is not drawn on (velista 0097,
 * section 4).
 *
 * A constant rather than a written string, for `RENDERS_WHILE_CONNECTING`'s reason:
 * the route table and the service that reads it cannot then name two different keys.
 */
export const NAV_CHROME = 'chrome';

/** The one value {@link NAV_CHROME} takes. Anything else is the bar being drawn. */
export const NO_NAV_CHROME = 'none';

/**
 * Whether the app draws its bottom bar on the screen it is on.
 *
 * ## Why this is a service, and why it is here
 *
 * `AppLayout` asks the question and `AppNav` is drawn by it, and both live in `ui`,
 * which may not inject `Router` (rule D1, and `layering.spec.ts` enforces it).
 * `StartupGate` is the precedent, and this is the same shape for the same reason: the
 * answer needs the URL and the activated route's `data`, so the reading happens here
 * and the layout reads the answer.
 *
 * ## The bar is drawn unless something says otherwise
 *
 * Which is the opposite of a page opting in. Three things say otherwise, and they are
 * three because they are three different facts:
 *
 * 1. **The screen says so**, through `data.chrome === 'none'` on the deepest activated
 *    route. The front door, the five credential screens, an unaccepted invitation and a
 *    guest's way in: each is one task with one way out, and two of the three tabs need
 *    an account.
 * 2. **A sheet is open.** A sheet keeps its own bottom edge on the screen's bottom edge
 *    and its scrim covers everything, so a bar under it would be a row of controls
 *    nobody can press (section 5). A sheet is a child route under the `sheet` segment,
 *    so this is a test on the URL rather than a flag anybody has to remember to set.
 * 3. **The session cannot use the tabs**, which is {@link usable} below.
 *
 * ## Under-showing is the safe way to be wrong
 *
 * {@link usable} defaults to false and is set from `SessionStore` by `app-providers.ts`,
 * the one file allowed to see both libraries. A bar that appears one frame late costs a
 * navigation; a bar drawn for an anonymous visitor hands them two tabs that answer with
 * a sign in screen, which teaches that the bar is a trap.
 */
@Injectable({ providedIn: 'root' })
export class NavChrome {
  private readonly _router = inject(Router);

  /**
   * The URL the app is on, as the router serializes it.
   *
   * Seeded from the router rather than left empty until the first `NavigationEnd`, for
   * `StartupGate`'s reason: the initial navigation can complete before anything injects
   * this, in which case no event is coming.
   */
  private readonly _url = signal(this._router.url);

  private readonly _chromeless = signal(
    readsNoChrome(this._router.routerState.snapshot.root)
  );

  private readonly _usable = signal(false);

  /** Where the app is, for the tab that lights up. See `AppNav`. */
  readonly url: Signal<string> = this._url.asReadonly();

  /**
   * Whether the person looking at the app can use the tabs at all.
   *
   * Written by `app-providers.ts` from `SessionStore`, because `platform` does not
   * import `data-access` and never will: this is the inversion `ConnectionState` uses,
   * where the signal lives here and the layer that knows the answer writes it.
   */
  readonly usable: Signal<boolean> = this._usable.asReadonly();

  /**
   * Whether the bar belongs to the screen the app is on, sheet or no sheet.
   *
   * This is {@link visible} without rule 2, and it is what the layout reserves room
   * for. The two are separate because a sheet is a passing state over a page that is
   * still there: reserving on `visible` alone would reflow that page by the height of
   * the bar on the way into every sheet and back again on the way out, which is a
   * scroller growing and shrinking under a scrim for no reason anybody asked for.
   */
  readonly reserved: Signal<boolean> = computed(
    () => this._usable() && !this._chromeless()
  );

  /**
   * Whether the URL addresses a sheet, whatever the bar is doing.
   *
   * The tour reads it: no card is drawn while a sheet is open (velista `0099`).
   */
  readonly sheetOpen: Signal<boolean> = computed(() => holdsSheet(this._url()));

  /** Whether `AppLayout` draws the bar. */
  readonly visible: Signal<boolean> = computed(
    () => this.reserved() && !this.sheetOpen()
  );

  constructor() {
    // Every completed navigation, because both things this reads change on one.
    // Nothing unsubscribes: the router outlives this service in both run modes, and
    // `@angular/core/rxjs-interop` is not available to anything in this app, so
    // `takeUntilDestroyed` is not an option here anyway.
    this._router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this._url.set(this._router.url);
        this._chromeless.set(
          readsNoChrome(this._router.routerState.snapshot.root)
        );
      });
  }

  /** Say whether this session may use the tabs. Called from the app layer only. */
  setUsable(usable: boolean): void {
    this._usable.set(usable);
  }
}

/**
 * Whether the deepest activated route asks for no chrome.
 *
 * The **deepest** one, for the reason `StartupGate` reads the deepest: the flag is a
 * statement about the screen that will be drawn, and the route that draws it is the
 * leaf. Angular's `emptyOnly` data inheritance has already decided what that leaf's
 * `data` holds, so a child carrying `data` of its own does not inherit this.
 */
function readsNoChrome(from: ActivatedRouteSnapshot): boolean {
  let deepest = from;
  while (deepest.firstChild !== null) {
    deepest = deepest.firstChild;
  }

  return deepest.data[NAV_CHROME] === NO_NAV_CHROME;
}

/**
 * Whether the URL addresses a sheet.
 *
 * The query string and the fragment are cut off first, so a parameter that happens to
 * hold the word cannot close the bar on a page.
 */
function holdsSheet(url: string): boolean {
  const path = url.split('#')[0]?.split('?')[0] ?? '';

  return path.split('/').includes(SHEET_SEGMENT);
}
