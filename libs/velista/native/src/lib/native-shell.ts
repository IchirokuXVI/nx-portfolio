import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { APP_KEY } from '@portfolio/velista/models';
import { AppBack, BrowserFacade } from '@portfolio/velista/platform';
import { NATIVE_PLUGINS, type NativePlugins } from './native-plugins';

/**
 * The id the app ships under when nobody has asked Android yet: the production
 * flavor's (`capacitor.config.ts`). The staging flavor adds a suffix, which
 * {@link NativeShell} reads from `getInfo()` at startup.
 */
export const DEFAULT_NATIVE_APP_ID = 'app.velista';

/** Where an app id is listed on Google Play. */
export function storeUrlFor(appId: string): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`;
}

/**
 * The in app address of a URL Android handed over, or null when it is not one.
 *
 * Only the path, query and fragment: the host is the app's own origin by D1, and the
 * locale guard inserts a missing locale on arrival as it does for any link. The
 * fragment is kept because the support handoff carries its code there.
 */
export function inAppUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Remembers, for the life of the WebView's session, that the URL the app was launched
 * with has been followed. Android keeps that URL on the activity for as long as it
 * lives, so without this a reload (the offline recovery) would follow it again and
 * leave the page the person was on. Named `{role}:{appKey}` as `StorageKeys` are.
 */
const LAUNCH_URL_FOLLOWED_KEY = `native-launch-url-followed:${APP_KEY}`;

/**
 * The native listeners: the hardware back button, links that open the app, and the
 * app id the store link names. Started once from the environment initializer, and
 * only inside a native shell.
 */
@Injectable({ providedIn: 'root' })
export class NativeShell {
  private readonly _plugins = inject(NATIVE_PLUGINS);
  private readonly _back = inject(AppBack);
  private readonly _router = inject(Router);
  private readonly _browser = inject(BrowserFacade);
  private _appId: string | null = null;
  private _started: Promise<void> | null = null;

  /**
   * The id Android reports for this install, or the production id until it has
   * answered. Read synchronously by `APP_STORE_URL`, which the dead end face resolves
   * long after startup.
   */
  get appId(): string {
    return this._appId ?? DEFAULT_NATIVE_APP_ID;
  }

  start(): Promise<void> {
    return (this._started ??= this._start());
  }

  private async _start(): Promise<void> {
    const plugins = await this._plugins();
    const { app } = plugins;

    await app.addListener('backButton', () => this.onBackButton(plugins));
    await app.addListener('appUrlOpen', (event) => this.open(event.url, false));

    void app
      .getInfo()
      .then((info) => (this._appId = info.id))
      .catch(() => undefined);

    // A cold start by a link raises no `appUrlOpen`: Capacitor loads the bundle's
    // root and keeps the URL as the launch URL, so it is followed here, once.
    if (this._browser.readSessionStorage(LAUNCH_URL_FOLLOWED_KEY) === null) {
      this._browser.writeSessionStorage(LAUNCH_URL_FOLLOWED_KEY, '1');
      const launch = await app.getLaunchUrl().catch(() => undefined);
      if (launch !== undefined) {
        this.open(launch.url, true);
      }
    }
  }

  /**
   * A press of the hardware back button. Whatever is on screen answers first, then an
   * entry of ours is popped, and at the floor the app goes to the background instead
   * of closing (plan 0167, choices), so coming back finds it where it was.
   */
  onBackButton(plugins: NativePlugins): void {
    if (this._back.request() === 'floor') {
      void plugins.app.minimizeApp().catch(() => undefined);
    }
  }

  /**
   * Follow a link that opened the app. A cold start replaces the entry it landed on,
   * so the linked page is the floor as it is when a browser opens the same link; a
   * link that arrives while the app runs is a push, so back returns to where the
   * person was.
   */
  open(url: string, replaceUrl: boolean): void {
    const target = inAppUrl(url);
    if (target === null) {
      return;
    }
    void this._router.navigateByUrl(target, { replaceUrl });
  }
}
