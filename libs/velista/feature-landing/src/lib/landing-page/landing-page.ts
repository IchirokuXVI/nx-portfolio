import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  APP_MOUNT_PATH,
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  AccountNotice,
  GatewayError,
  GoogleSignIn,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  APP_KEY,
  type PreviewLineVm,
} from '@portfolio/velista/models';
import {
  APP_RUNTIME,
  appPath,
  BackendReadiness,
  sheetSegments,
} from '@portfolio/velista/platform';
import {
  AppBar,
  AppVersion,
  AuthActions,
  HomeHero,
  LegalLinks,
  ListPreviewCard,
} from '@portfolio/velista/ui';

/**
 * The front door: what somebody who is not signed in sees at the app's mount.
 *
 * Plan `0003` made this a branch of the home page, on the reasoning that a returning
 * user should not have to navigate past a marketing screen. Plan `0007` keeps the
 * reasoning and moves the enforcement: `anonymousOnlyGuard` sends a signed in visitor
 * straight to the dashboard, so the returning user still arrives in one navigation,
 * and the two screens stop being one component that renders at most half of its
 * imports at a time.
 *
 * It reads nothing from `ZoneStore` and does not need `SessionStore`, because the guard
 * has already established that the viewer is anonymous. It injected no data token at
 * all until plan 0015, which added exactly one: `AccountNotice`, so that somebody who
 * has just deleted their account is told once. That news has nowhere else to land —
 * after a delete there is no session, so the dashboard cannot report it — and the
 * notice holds no request and no identity.
 */
@Component({
  selector: 'lib-landing-page',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    AppBar,
    AppVersion,
    AuthActions,
    HomeHero,
    LegalLinks,
    ListPreviewCard,
  ],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPage {
  private readonly _localeStore = inject(RokuLocaleStore);
  private readonly _mountPath = inject(APP_MOUNT_PATH);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _t = inject(RokuTranslatorService);
  private readonly _notice = inject(AccountNotice);
  private readonly _readiness = inject(BackendReadiness);
  private readonly _google = inject(GoogleSignIn);
  private readonly _basePath = inject(APP_BASE_PATH);

  /**
   * Whether to offer Google: everywhere but the native shell, where Google refuses to
   * sign anybody in from an embedded WebView (velista `0166`).
   */
  readonly googleOffered = inject(APP_RUNTIME) !== 'native';

  /** True from a tap on Google until the document leaves, or until the start fails. */
  readonly googleStarting = signal(false);

  /** The translation key of a refused Google start, or null. */
  readonly googleError = signal<string | null>(null);

  /**
   * Whether the four ways in may act yet (plan 0071, section 5.1).
   *
   * `!== 'ready'`, so it covers `unreachable` as well as `connecting`, which is right:
   * the actions cannot work either way. A connection lost mid session is a different
   * thing again and still draws its own blocking screen over the top of this one.
   *
   * This page injects one platform signal and asks nothing else of it. The screen it
   * would otherwise be waiting behind is not drawn here, because landing is the single
   * route that renders while connecting: it is the front door, and a visitor who has
   * just tapped a link deserves to see what the product is rather than a wait.
   */
  readonly actionsHeld = computed(() => this._readiness.state() !== 'ready');

  /** See `BackendReadiness.slow`. Wall clock from the app starting, per D8. */
  readonly startupSlow = this._readiness.slow;

  /**
   * The languages the header offers.
   *
   * Read from the **parent** route's data rather than from `APP_USABLE_LOCALES`, which
   * lives in `feature-shell`. `feature-shell` lazily imports this library in its route
   * table, so importing it back would close a cycle in the project graph. The
   * `AppLayout` route already carries `supportedLocales` for `localeCorrectionGuard`,
   * so the value is there with nothing to add to the route table, and reading it from
   * route data is what `usable-locales.ts` already says a switcher does.
   *
   * `parent` explicitly, not inheritance: Angular's default `paramsInheritanceStrategy`
   * of `emptyOnly` hands parent data down to this route, whose path is `''`, and would
   * **not** hand it to a sibling whose path is not empty. Depending on that distinction
   * would make a copy of this line break the moment it moved to a page with a path.
   */
  readonly locales = (this._route.parent?.snapshot.data['supportedLocales'] ??
    []) as readonly string[];

  /** Reads the store signal, so the label follows an in-place switch. */
  readonly locale = this._localeStore.locale;

  /**
   * Whether an account was just deleted, so this screen can say so once.
   *
   * The one data token this page injects, and the class comment's "no data token at
   * all" is now one exception rather than none. It is worth it: after a delete there
   * **is** no session, so the dashboard cannot report it, and the front door is where
   * the person lands. `AccountNotice` is already the thing every other piece of news
   * about an account travels in, and it holds no request and no identity.
   *
   * A plain field read once at construction, and **not** a `computed`: the notice is
   * cleared in the same breath so a reload of this URL does not repeat the sentence,
   * and a `computed` that wrote to a signal would throw. One-shot is also what this is:
   * the news does not change while the screen is up.
   */
  readonly accountDeleted = this._readDeletedNotice();

  /**
   * Where the two legal links go (velista `0172`). The front door is the home page
   * Google's consent screen names, and its review looks for the policy link here,
   * in view without signing in.
   */
  readonly legalUrls = computed(() => ({
    privacy: appPath(this.locale(), this._basePath, 'privacy'),
    terms: appPath(this.locale(), this._basePath, 'terms'),
  }));

  /** Uppercased here rather than in the app bar, which keeps taking a plain string. */
  readonly localeLabel = computed(() => this.locale().toLocaleUpperCase());

  /**
   * The illustrative list.
   *
   * Invented, and it stays invented: it exists to show what the product is in one
   * glance. It shows what a line can be on purpose, because "some of these are dealt with
   * and somebody else did them" is the whole idea of the product and is hard to say in
   * a sentence.
   *
   * `0003` argued these strings should stay in English, on the grounds that a
   * translator asked to localize "Milk" would wonder what it was for. `0007` reverses
   * that: they are the only words on the front door that describe what the product
   * does, and a Spanish speaker reading `Milk / Bread / Tomatoes` is looking at an
   * English app. The keys are named for their purpose, which answers the worry.
   *
   * Translated from the `.ts` rather than the template because this is one typed
   * `PreviewLineVm[]` handed to `ListPreviewCard` as a single input, so
   * `RokuTranslatorService.t()` is the tool.
   */
  readonly previewLines = computed<readonly PreviewLineVm[]>(() => {
    // A dependency, not a statement: it re-runs this on a language switch, without
    // which the card keeps the previous language's groceries.
    //
    // Nothing here has to wait for the strings to load. Plan 0006 section 4 puts a
    // resolver on the parent route, so this component cannot be created before the
    // namespace is ready, which is exactly the guarantee that lets a `.ts` caller use
    // `t()` at all.
    this.locale();

    return [
      {
        content: this._t.t('home.preview.line.milk.content'),
        // Zero, and bought. The one line on the card that shows what the whole
        // product is: you wanted some, somebody got them, the line stays where it
        // is at nought rather than being ticked off or deleted.
        quantity: '0',
        indicator: 'bought',
        by: 'A',
      },
      {
        content: this._t.t('home.preview.line.bread.content'),
        quantity: '2',
        indicator: null,
        by: null,
      },
      // The `by` initials stay hardcoded on all three lines: they stand for people
      // rather than words, and a letter is not translatable.
      {
        content: this._t.t('home.preview.line.tomatoes.content'),
        // Still wanted, and the shop had none. Not having found something is not the
        // same as no longer needing it, which is why the number is untouched.
        quantity: '6',
        indicator: 'notAvailable',
        by: 'M',
      },
    ];
  });

  /**
   * Switches the app's language in place.
   *
   * `switchAppLocale` is the shared mechanism from rokutranslator `0003` and it already
   * does all three parts: it persists the choice under this app's key, calls
   * `RokuTranslator.changeLocale` so the `pure: false` pipe re-translates without a
   * reload, and rewrites the leading locale segment of the URL with a router
   * navigation. Nothing new is needed in the localization library for this.
   */
  switchLocale(locale: string): void {
    // The mount is passed because the locale sits *below* it now: rewriting index 0
    // would replace `velista` itself and send the visitor to `/en/en`. Read from DI
    // rather than written down, so the standalone build (mount `''`) needs no branch.
    void this._localeStore.switchAppLocale(APP_KEY, locale, this._mountPath);
  }

  /**
   * The two ways in that need no credentials, which plan 0008 built.
   *
   * A navigation rather than a `routerLink` on the button, because the control is an
   * `AuthActions` output rather than an anchor, and because the destination is a
   * **sibling** of this route: relative to the sheet's parent, which is this page.
   * `relativeTo` the activated route is what makes that true in both the mounted and
   * the standalone build without either the locale segment or the mount appearing
   * anywhere in this file (extraction contract, item 5).
   */
  createZone(): void {
    void this._router.navigate(sheetSegments('zones', 'new'), {
      relativeTo: this._route,
    });
  }

  joinZone(): void {
    void this._router.navigate(sheetSegments('zones', 'join'), {
      relativeTo: this._route,
    });
  }

  /**
   * Signing in, which plan 0009 built.
   *
   * A sibling of this route rather than a child, because it is a destination and not a
   * sheet: `relativeTo` this page's own route, which is the app's mount, so neither the
   * locale segment nor the mount is written down here (extraction contract, item 5).
   */
  signInWithEmail(): void {
    // The query is kept, because `authenticatedGuard` leaves the page it refused
    // there as `returnUrl` (velista `0154`), and sign in comes back to it.
    void this._router.navigate(['auth', 'login'], {
      relativeTo: this._route,
      queryParamsHandling: 'preserve',
    });
  }

  /**
   * Google, which sends the document to the gateway (velista `0171`).
   *
   * Offered to whoever is on this page. Since backend `0230` a guest is linked in place
   * and keeps every group, so nobody is turned away from it. On success the page is
   * leaving, so the busy state stays on; a refusal is a sentence under the buttons.
   */
  async continueWithGoogle(): Promise<void> {
    if (this.googleStarting()) {
      return;
    }

    this.googleStarting.set(true);
    this.googleError.set(null);

    try {
      await this._google.start();
    } catch (error) {
      this.googleStarting.set(false);
      this.googleError.set(googleFailureKey(error));
    }
  }

  /** See {@link accountDeleted}. Reads the one-shot notice and consumes it. */
  private _readDeletedNotice(): boolean {
    const deleted = this._notice.notice()?.kind === 'deleted';
    if (deleted) {
      this._notice.clear();
    }

    return deleted;
  }
}

/**
 * The sentence a refused Google start gets here, with the keys `authErrorCopy` in
 * `feature-auth` gives the same failure on sign in. Not imported from there, because
 * this page would then load every auth page with it.
 */
function googleFailureKey(error: unknown): string {
  if (error instanceof GatewayError) {
    if (error.code === 'impersonation_not_allowed') {
      return 'support.refused';
    }
    if (error.code === 'rate_limited') {
      return 'auth.error.tooMany';
    }
  }

  return 'entry.error.failed';
}
