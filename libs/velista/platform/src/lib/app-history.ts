import { inject, Injectable } from '@angular/core';
import {
  NavigationEnd,
  NavigationStart,
  Router,
  type Navigation,
} from '@angular/router';

/**
 * Whether the browser's back button would land somewhere this app put on the stack.
 *
 * Every back control in velista pops rather than navigating, because a person who
 * reached a screen three different ways expects the one answer that is right in all
 * three (`PageNavigation`). Popping is only safe while there is an entry behind that
 * **this document wrote**: the entry below the one a tab loaded on belongs to whoever
 * linked here, and it can be another site entirely. So every one of those controls
 * takes a fallback URL, and this service is the thing that decides which of the two
 * happens.
 *
 * ## Why the history state cannot answer it
 *
 * It used to. The router stamps `navigationId` into each entry's state, counting from
 * one, and the rule was that an id above one meant this document had navigated at least
 * once and `back` returned to that. That reads as sound and is wrong, because a
 * navigation that **replaces** bumps the id without adding an entry, and the replacing
 * navigations are exactly the ones that happen on a cold arrival:
 *
 * - the locale guard rewriting `/zones/z1` to `/en/zones/z1`. A guard redirect inherits
 *   `replaceUrl` from the navigation it interrupted, and the initial navigation sets it,
 *   so the corrected URL replaces the entry the tab loaded on and carries id 2.
 * - `SheetNavigation.leaveTo`, which replaces by design so a spent sheet's URL stops
 *   existing. A sheet opened from a shared link and submitted leaves the reader on a
 *   page whose entry reads id 2 and has the linking site directly behind it.
 *
 * In both, the old check said yes and the back button left velista for whichever site
 * the visitor came from. That is the one mistake a back button may never make.
 *
 * ## What it counts instead
 *
 * The entries this document actually pushed, in order, and where in them we are now.
 * A push appends, a replace rewrites the entry we are standing on, and a popstate moves
 * the cursor to whichever entry the browser restored. `-1` is the entry the document
 * loaded on: real, ours, and the floor. Nothing below it was written by this app, so
 * from there the answer is no and the caller uses its fallback.
 *
 * Every input comes from the router's own events, so this never reads `history` and
 * never has to guess at another document's state. The one judgement call is push versus
 * replace, and it mirrors the router's: it replaces when the caller asked for it, or
 * when the URL is the one already on screen, and pushes otherwise.
 *
 * ## It has to be watching before it is asked
 *
 * Nothing injects it until a back button is pressed, and by then every navigation it
 * needed to see has happened. So `app-providers.ts` calls {@link watch} in an
 * environment initializer, which is the same split `InstallStore` is under: being
 * *available* is this library's business, being *running* is the app's.
 *
 * A separate call rather than a constructor subscription, because the constructor is
 * reached by every screen that injects `PageNavigation`, including in the many specs
 * that stand a `Router` double in whose only members are the two methods the screen
 * calls. Those specs are not about history, they should not have to grow an event
 * stream to keep compiling, and a service that answers no until it is started gives
 * them exactly the fallback behaviour they already assert.
 *
 * Unwatched, or started late, it reports no entry behind, and each back control walks
 * to its own fallback: wrong about the nicest destination, never wrong about the domain.
 */
@Injectable({ providedIn: 'root' })
export class AppHistory {
  private readonly _router = inject(Router);

  /**
   * The navigation ids of the entries this document pushed, bottom to top.
   *
   * Ids rather than URLs because a popstate names its destination by id, and because
   * two entries can hold the same URL.
   */
  private _pushed: number[] = [];

  /**
   * Where we are standing: an index into {@link _pushed}, or `-1` for the entry the
   * document loaded on, which sits below all of them.
   */
  private _cursor = -1;

  /** The URL the browser is showing, so the next navigation can tell push from replace. */
  private _shownUrl: string | null = null;

  /** The navigation being announced, kept so its end can read how it started. */
  private _pending: NavigationStart | null = null;

  private _watching = false;

  /**
   * Start counting, from the app's own providers.
   *
   * Idempotent, because `appProviders` is spread onto the route table as well as onto
   * the standalone bootstrap and both initializers run in the standalone build.
   */
  watch(): void {
    if (this._watching) {
      return;
    }

    this._watching = true;

    this._router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this._started(event);
      } else if (event instanceof NavigationEnd) {
        this._ended(event);
      }
    });
  }

  /**
   * Whether `Location.back()` would stay in this app.
   *
   * True only from an entry this document pushed, because the entry behind such an
   * entry is one of ours as well: either a lower push or the URL the tab loaded on.
   */
  hasEntryBehind(): boolean {
    return this._cursor >= 0;
  }

  /**
   * A popstate is applied here rather than on the way out, because the browser has
   * already moved by the time it is announced and the navigation it starts may never
   * end: a guard can redirect it, and the redirect replaces the entry we have already
   * been moved to. Placing the cursor now is right in both endings.
   *
   * `restoredState` names the entry by the id it was written with, and a replace keeps
   * {@link _pushed} in step with that, so `indexOf` finds it. Not finding it means the
   * browser restored something this document did not push, which is the floor.
   */
  private _started(event: NavigationStart): void {
    this._pending = event;

    if (event.navigationTrigger !== 'popstate') {
      return;
    }

    const restoredId = event.restoredState?.navigationId;

    this._cursor =
      restoredId === undefined ? -1 : this._pushed.indexOf(restoredId);
  }

  /**
   * A navigation that finished is one that reached the address bar, so this is where
   * the stack changes shape. A popstate did that before it was announced and was
   * already accounted for; a hashchange is an entry somebody else in this document
   * pushed, and popping back onto it is as safe as popping onto one of ours.
   */
  private _ended(event: NavigationEnd): void {
    const navigation = this._navigationFor(event);
    const trigger = navigation?.trigger ?? this._pending?.navigationTrigger;
    const url = event.urlAfterRedirects;

    if (trigger !== 'popstate' && !navigation?.extras.skipLocationChange) {
      if (this._pushes(navigation, url)) {
        this._push(event.id);
      } else {
        this._replace(event.id);
      }
    }

    this._pending = null;
    this._shownUrl = url;
  }

  /**
   * The router's own rule, from `setBrowserUrl`: it replaces when the caller asked to,
   * or when the URL it is going to is the one already showing, and pushes otherwise.
   *
   * Not knowing is answered as a replace, because the two mistakes do not cost the
   * same. Over-counting lets the cursor climb off an entry this document never pushed,
   * which sends the reader out of the app; under-counting costs a back button that
   * walks to its fallback instead of popping.
   */
  private _pushes(navigation: Navigation | null, url: string): boolean {
    if (!navigation || navigation.extras.replaceUrl) {
      return false;
    }

    return this._shownUrl !== null && this._shownUrl !== url;
  }

  /**
   * A push discards whatever the browser was holding ahead of us, which is why the
   * list is trimmed to the cursor before the new entry goes on.
   */
  private _push(id: number): void {
    this._pushed = [...this._pushed.slice(0, this._cursor + 1), id];
    this._cursor = this._pushed.length - 1;
  }

  /**
   * A replace leaves the stack the shape it was and only renames the entry we are on,
   * so the id kept for it has to be renamed too or a later popstate would not
   * recognise its own destination. On the floor there is nothing to rename.
   */
  private _replace(id: number): void {
    if (this._cursor >= 0) {
      this._pushed = this._pushed.map((entry, index) =>
        index === this._cursor ? id : entry
      );
    }
  }

  /**
   * The navigation being reported, which the router keeps until after `NavigationEnd`
   * has been delivered. It is read for the trigger and for `replaceUrl`, neither of
   * which the event itself carries.
   */
  private _navigationFor(event: NavigationEnd): Navigation | null {
    const navigation = this._router.getCurrentNavigation();

    return navigation?.id === event.id ? navigation : null;
  }
}
