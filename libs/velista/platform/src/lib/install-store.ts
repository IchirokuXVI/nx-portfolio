import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import { BrowserFacade } from './browser-facade';
import {
  installGuideFor,
  type InstallGuide,
  type InstallState,
} from './install-state';
import { StorageKeys } from './storage-keys';

/**
 * The one thing in this app allowed to touch installability (plan 0033, rule I1).
 *
 * `beforeinstallprompt`, `appinstalled`, `display-mode` and `navigator.standalone` are
 * read here and nowhere else. Every screen injects this and reads signals.
 *
 * ## Why it is constructed at bootstrap and not by the page that shows it
 *
 * `beforeinstallprompt` fires **at the browser's discretion, once**, and a page may
 * only keep the event and call `prompt()` on it later from inside a user gesture. There
 * is no API that asks whether installing is possible (section 2.1). So a listener
 * attached in the install page's constructor has already missed the event on every
 * other route, which is every route somebody actually arrives on, and the button would
 * work only for people who deep linked to the install page, which is nobody.
 * `app-providers.ts` therefore constructs this through an environment initializer.
 *
 * It is provided in `VELISTA_PLATFORM_PROVIDERS` rather than `providedIn: 'root'` for
 * the reason that file records: under module federation the root injector is the
 * shell's, and this store reaches values the app provides.
 *
 * ## Installedness is a belief, not a fact
 *
 * Nothing tells a browser tab that the app was installed last week on the same device,
 * and **no event fires when somebody uninstalls** (section 2.4). `installed` is
 * therefore what this browser currently believes, and rule I4 is what makes a wrong
 * belief survivable: no state of any screen that renders this may be a dead end.
 */
// Provided by the app layer, never root: rule D5 (plan 0004 section 9), and D1 above.
@Injectable()
export class InstallStore {
  /** What this browser can be asked to do. Three states and no fourth (D2). */
  readonly state: Signal<InstallState>;

  /** Which steps to draw. Chosen by user agent, and it decides nothing else (I3). */
  readonly guide: Signal<InstallGuide>;

  /** Whether {@link prompt} would do anything. The button's whole condition. */
  readonly canPrompt: Signal<boolean>;

  private readonly _browser = inject(BrowserFacade);

  /**
   * The captured event, held outside a signal on purpose: it is a handle, not state.
   * What the screen reacts to is {@link _prompt}, which is the same fact as a boolean.
   */
  private _event: BeforeInstallPromptEvent | null = null;
  private readonly _prompt = signal(false);

  /**
   * The `appinstalled` fact, remembered across reloads.
   *
   * The event fires once, in the tab that installed, and the installed window is a
   * separate document that never sees it. Persisting it is what stops the account row
   * flipping back to an invitation on the next page load in the same tab.
   */
  private readonly _installed = signal(false);

  constructor() {
    this._installed.set(
      this._browser.readStorage(StorageKeys.installed) === 'true'
    );

    // Phrased as `standalone` rather than `browser`, so the false the facade gives on
    // the server, in a test and on a browser without `matchMedia` is the answer this
    // wants by default: not installed. See `BrowserFacade.matchMedia`.
    const standalone = this._browser.matchMedia('(display-mode: standalone)');

    // Older iOS, which has no `display-mode` and answers this instead. A non standard
    // property, so it is read off a widened type rather than declared globally.
    const iosStandalone =
      (this._browser.window?.navigator as IosNavigator | undefined)
        ?.standalone === true;

    this.state = computed(() => {
      if (standalone() || iosStandalone || this._installed()) {
        return 'installed';
      }
      return this._prompt() ? 'ready' : 'manual';
    });

    this.canPrompt = computed(() => this.state() === 'ready');

    const navigator = this._browser.window?.navigator;
    const decided = installGuideFor(navigator?.userAgent ?? '', {
      maxTouchPoints: navigator?.maxTouchPoints,
    });
    this.guide = signal(decided).asReadonly();

    this._listen();
  }

  /**
   * Ask the browser to install, if it has given us something to ask with.
   *
   * **Call this as the first statement of a click handler, with no `await` before it.**
   * `prompt()` requires transient user activation and awaiting anything spends it, so a
   * caller that does work first gets an install dialog that never opens (D6).
   *
   * The event is cleared whatever happens, including on a rejection (rule I2). After
   * `prompt()` resolves it is spent: Chromium may fire a fresh one later and may not,
   * and holding a spent event leaves a button that looks identical and does nothing,
   * which is worse than no button. The state falls back to `manual`, whose label
   * navigates to the steps instead, so nothing is stuck.
   */
  async prompt(): Promise<InstallPromptOutcome> {
    const event = this._event;
    if (event === null) {
      return 'unavailable';
    }

    this._event = null;
    this._prompt.set(false);

    try {
      await event.prompt();
      const choice = await event.userChoice;
      return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      // A prompt refused by the browser, usually because the gesture was already
      // spent. Not a failure anybody has copy for: the steps are still on the page.
      return 'unavailable';
    }
  }

  /**
   * The two events, attached once, for the life of the app.
   *
   * `preventDefault` on `beforeinstallprompt` is what stops Chromium's own mini
   * infobar competing with the page that is about to offer the same thing.
   */
  private _listen(): void {
    const win = this._browser.window;
    if (win === null) {
      return;
    }

    const onBeforePrompt = (event: Event) => {
      event.preventDefault();
      this._event = event as BeforeInstallPromptEvent;
      this._prompt.set(true);
    };

    const onInstalled = () => {
      this._event = null;
      this._prompt.set(false);
      this._installed.set(true);
      this._browser.writeStorage(StorageKeys.installed, 'true');
    };

    win.addEventListener('beforeinstallprompt', onBeforePrompt);
    win.addEventListener('appinstalled', onInstalled);
    inject(DestroyRef).onDestroy(() => {
      win.removeEventListener('beforeinstallprompt', onBeforePrompt);
      win.removeEventListener('appinstalled', onInstalled);
    });
  }
}

/**
 * How an ask went.
 *
 * `unavailable` covers both "there was nothing to ask with" and "the browser refused
 * the ask", because a caller can do nothing different about the two: the steps are on
 * the page either way.
 */
export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

/**
 * The event Chromium fires and nobody else does.
 *
 * Declared here rather than globally: it is not in the DOM lib because it is not in any
 * standard, and a global declaration would tell every other file in this workspace that
 * it can be relied on.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Safari on iOS, which answers this instead of `display-mode` on older versions. */
interface IosNavigator extends Navigator {
  readonly standalone?: boolean;
}
