import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  APP_BASE_PATH,
  APP_STANDALONE_ORIGIN,
} from '@portfolio/velista/models';
import {
  appPath,
  BrowserFacade,
  InstallStore,
  PageNavigation,
} from '@portfolio/velista/platform';
import {
  AppVersion,
  BrandMark,
  ChevronLeftIcon,
  InstallBenefits,
  InstallPanel,
} from '@portfolio/velista/ui';

/**
 * The page that finally mentions that this app can be installed (plan 0033).
 *
 * `0013` made it installable and then told nobody: the app has a manifest, a service
 * worker with a fetch handler and its own origin, which is the complete set of things
 * Chromium asks for, and the only way to find out was a browser menu nobody opens.
 *
 * ## A route, and a public one
 *
 * A route rather than a sheet, by `0009` section 4.1's test as `0015` applied it: it is
 * deep linkable, it is somewhere a person goes deliberately, and it is the URL you would
 * put in a message. Public, with no guard, because the whole point of a link is that it
 * can be sent to somebody who has never signed in. It makes no request of any kind.
 *
 * ## Nothing here loads
 *
 * The primary slot is occupied from the first frame and the state only ever improves
 * into it (D4): the steps are what renders before the browser has said anything, and a
 * button appears above them if `beforeinstallprompt` arrives. So there is no spinner and
 * no skeleton, and the improvement is announced through **one polite live region that
 * exists from the first frame**, in the shape `0015` used for the rename: a region
 * created at the moment its text appears is often not announced at all.
 *
 * ## Under the shell it does not install, it points (D5)
 *
 * Mounted at the portfolio's `/velista` the document, the manifest and the worker all
 * belong to the portfolio, so an install triggered here would install the portfolio
 * under the portfolio's name. In that mode the whole screen becomes one card naming
 * velista's own address. `APP_BASE_PATH` is what says which mode this is, and a
 * component may inject it safely; a **guard** may not (`0003` D7).
 */
@Component({
  selector: 'lib-install-page',
  imports: [
    RokuTranslatorPipe,
    AppVersion,
    BrandMark,
    ChevronLeftIcon,
    InstallBenefits,
    InstallPanel,
  ],
  templateUrl: './install-page.html',
  styleUrl: './install-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallPage {
  private readonly _install = inject(InstallStore);
  private readonly _browser = inject(BrowserFacade);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _origin = inject(APP_STANDALONE_ORIGIN);
  private readonly _router = inject(Router);
  private readonly _pages = inject(PageNavigation);
  private readonly _locale = inject(RokuLocaleStore).locale;

  readonly state = this._install.state;
  readonly guide = this._install.guide;

  /**
   * Whether this is the portfolio's copy of the app rather than velista's own.
   *
   * The mount is the only difference between the two modes, and it is the difference
   * that decides whether installing means anything here at all (D5, rule I5).
   */
  readonly mounted = this._basePath !== '';

  /** The address to send a mounted reader to. Empty when nobody configured one. */
  readonly standaloneOrigin = this._origin;

  /**
   * What the live region says, or null while it has nothing to say.
   *
   * Set once, when a prompt arrives and the slot gains a button. It is deliberately not
   * a `computed` over the state: this announces a **change**, and a computed would also
   * fire on the first frame for somebody who arrived with the prompt already in hand,
   * announcing a button that was simply there.
   */
  readonly announced = signal<string | null>(null);

  /** The address without its scheme, which is how a person says it out loud. */
  readonly originLabel = computed(() =>
    this.standaloneOrigin.replace(/^https?:\/\//, '')
  );

  constructor() {
    // Seeded with whatever the state already is, so the effect's own first run cannot
    // announce anything: somebody who arrived with a prompt already in hand is not
    // being told about a change, they are being told about the page they can see.
    let previous = this._install.state();

    effect(() => {
      const state = this._install.state();
      if (state === 'ready' && previous !== 'ready') {
        this.announced.set('install.announce.ready');
      }
      previous = state;
    });
  }

  /**
   * Ask the browser to install.
   *
   * The call is the first statement, with nothing awaited before it: `prompt()` needs
   * transient user activation and awaiting anything spends it (D6). There is nothing to
   * report afterwards, because the store's state is what the screen is drawn from and a
   * dismissal simply leaves it at `manual`, whose slot holds the steps.
   */
  async install(): Promise<void> {
    await this._install.prompt();
  }

  /** The mounted mode's one action: velista's own origin, where installing works. */
  openStandalone(): void {
    if (this.standaloneOrigin !== '') {
      this._browser.openExternal(this.standaloneOrigin);
    }
  }

  /**
   * Back, to wherever the reader came from.
   *
   * Popping rather than routing, because this page is reachable from the account
   * screen, from a link somebody was sent, and from the front door, and the page it
   * should return to is whichever of those it was. A cold arrival on the link has
   * nothing behind it, so that one falls to the app's own front door rather than
   * leaving the button inert.
   */
  back(): void {
    void this._pages.back(appPath(this._locale(), this._basePath));
  }

  /** The confirmation's own way out, for somebody with nothing left to do here. */
  async done(): Promise<void> {
    await this._toFrontDoor();
  }

  private async _toFrontDoor(): Promise<void> {
    await this._router.navigateByUrl(appPath(this._locale(), this._basePath));
  }
}
