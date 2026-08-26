import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  DOCUMENT,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
  Signal,
} from '@angular/core';

/**
 * The one place this app is allowed to touch a browser-only global.
 *
 * Plan 0001, D2: SSR is deferred to the standalone phase but nothing in the remote
 * phase may make it harder, so `window`, `document`, `navigator` and `localStorage`
 * are never read at module scope or in a constructor anywhere else. Every one of
 * them is an injected dependency, guarded by `isPlatformBrowser`, from day one.
 * Under a server render every accessor here degrades to a null or a no-op instead
 * of throwing.
 *
 * D6 also routes connection loss through this facade: `onLine` is a signal fed by
 * the `online` and `offline` window events, so the screen that reacts to it never
 * touches `navigator` itself.
 */
@Injectable({ providedIn: 'root' })
export class BrowserFacade {
  /** False during a server render. Guard anything browser-only on this. */
  readonly isBrowser: boolean;

  /**
   * Whether the browser believes it has a network connection.
   *
   * `navigator.onLine` is a floor, not a guarantee: it reports the link, not
   * whether the gateway is reachable. Treat a false as certainly offline and a
   * true as merely probably online — every mutation still needs a visible failure
   * path (plan 0001, D6).
   *
   * Always true on the server, so a server render never emits the offline screen.
   */
  readonly onLine = signal(true);

  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _document = inject(DOCUMENT);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _mediaQueries = new Map<string, Signal<boolean>>();

  constructor() {
    this.isBrowser = isPlatformBrowser(this._platformId);
    if (!this.isBrowser) {
      return;
    }

    const win = this.window;
    if (!win) {
      return;
    }

    this.onLine.set(win.navigator.onLine);

    const goOnline = () => this.onLine.set(true);
    const goOffline = () => this.onLine.set(false);
    win.addEventListener('online', goOnline);
    win.addEventListener('offline', goOffline);
    this._destroyRef.onDestroy(() => {
      win.removeEventListener('online', goOnline);
      win.removeEventListener('offline', goOffline);
    });
  }

  /** The window, or null on the server. */
  get window(): (Window & typeof globalThis) | null {
    return this.isBrowser ? this._document.defaultView : null;
  }

  /** The document. Injected, so it is safe to hold on the server too. */
  get document(): Document {
    return this._document;
  }

  /** The location, or null on the server. */
  get location(): Location | null {
    return this.window?.location ?? null;
  }

  /**
   * A media query as a signal, so a component can react to `prefers-color-scheme`
   * or `prefers-reduced-motion` without ever touching `matchMedia` itself.
   *
   * **False on the server, and false when the browser has no `matchMedia`.** That
   * is a deliberate bias rather than an oversight: a caller must phrase the query
   * so the answer it wants by default is the false one. The theme store asks for
   * `(prefers-color-scheme: light)` rather than `dark` for exactly this reason,
   * which is what makes Night the default under a server render, in a test, and
   * on a browser that reports nothing (plan 0002, section 4.5).
   *
   * Memoised per query string, so repeated calls share one listener and one
   * signal. Listeners are released with this root scoped service, which in
   * practice means for the life of the app.
   */
  matchMedia(query: string): Signal<boolean> {
    const cached = this._mediaQueries.get(query);
    if (cached) {
      return cached;
    }

    const matches = signal(false);
    const list = this.window?.matchMedia?.(query);
    if (list) {
      matches.set(list.matches);
      const onChange = (event: MediaQueryListEvent) =>
        matches.set(event.matches);
      list.addEventListener('change', onChange);
      this._destroyRef.onDestroy(() =>
        list.removeEventListener('change', onChange)
      );
    }

    const result = matches.asReadonly();
    this._mediaQueries.set(query, result);
    return result;
  }

  /**
   * Read a persisted value. Returns null when there is no storage *and* when
   * storage throws, which it does in private mode and with site data blocked —
   * a caller must never have to care which.
   */
  readStorage(key: string): string | null {
    try {
      return this.window?.localStorage.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  /** Persist a value. Silently does nothing when storage is unavailable. */
  writeStorage(key: string, value: string): void {
    try {
      this.window?.localStorage.setItem(key, value);
    } catch {
      // Storage full, blocked, or absent. Nothing here is load bearing enough
      // to fail a user action over.
    }
  }

  /** Remove a persisted value. Silently does nothing when storage is unavailable. */
  removeStorage(key: string): void {
    try {
      this.window?.localStorage.removeItem(key);
    } catch {
      // See writeStorage.
    }
  }

  /**
   * Reload the page. This is how D6's connection-loss screen recovers while the
   * app has no offline queue: when the connection returns, the app reloads itself.
   * Deliberately a facade method so the standalone SSR build keeps compiling.
   */
  reload(): void {
    this.location?.reload();
  }
}
