import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { APP_KEY, type PreviewLineVm } from '@portfolio/velista/models';
import {
  AppBar,
  AuthActions,
  HomeHero,
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
 * It injects **no data token at all**. It reads nothing from `ZoneStore`, and it does
 * not need `SessionStore` either, because the guard has already established that the
 * viewer is anonymous. The only service here is the locale store, which exists to make
 * the one control in the header do something (plan 0007, section 6.2).
 */
@Component({
  selector: 'lib-landing-page',
  imports: [
    RokuTranslatorPipe,
    RouterOutlet,
    AppBar,
    AuthActions,
    HomeHero,
    ListPreviewCard,
  ],
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPage {
  private readonly _localeStore = inject(RokuLocaleStore);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _t = inject(RokuTranslatorService);

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

  /** Uppercased here rather than in the app bar, which keeps taking a plain string. */
  readonly localeLabel = computed(() => this.locale().toLocaleUpperCase());

  /**
   * The illustrative list.
   *
   * Invented, and it stays invented: it exists to show what the product is in one
   * glance. It shows all three line states on purpose, because "some of these are done
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
        quantity: this._t.t('home.preview.line.milk.quantity'),
        status: 'READY',
        by: 'A',
      },
      {
        content: this._t.t('home.preview.line.bread.content'),
        quantity: this._t.t('home.preview.line.bread.quantity'),
        status: 'PENDING',
        by: null,
      },
      // The `by` initials stay hardcoded on all three lines: they stand for people
      // rather than words, and a letter is not translatable.
      {
        content: this._t.t('home.preview.line.tomatoes.content'),
        quantity: '',
        status: 'NOT_AVAILABLE',
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
    void this._localeStore.switchAppLocale(APP_KEY, locale);
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
    void this._router.navigate(['zones', 'new'], { relativeTo: this._route });
  }

  joinZone(): void {
    void this._router.navigate(['zones', 'join'], { relativeTo: this._route });
  }

  /**
   * Signing in, which plan 0009 built.
   *
   * A sibling of this route rather than a child, because it is a destination and not a
   * sheet: `relativeTo` this page's own route, which is the app's mount, so neither the
   * locale segment nor the mount is written down here (extraction contract, item 5).
   */
  signInWithEmail(): void {
    void this._router.navigate(['auth', 'login'], { relativeTo: this._route });
  }

  /**
   * Google, which is the one control on this page still recorded rather than routed.
   *
   * Not a frontend limitation: `GoogleController.callback` answers JSON rather than
   * redirecting into the app, and it never passes `linkUserId`, so it would mint a
   * fresh registered user for a caller who already has one. Both are gateway changes
   * (plan 0009, section 5.6). `auth/callback` is built and waiting for the first.
   *
   * Recorded rather than left unbound so the control is real, focusable and testable
   * now, and so that connecting it later is a single line here.
   */
  readonly pendingRoutes = signal<readonly string[]>([]);

  continueWithGoogle(): void {
    this._notYetRouted('auth.google');
  }

  /**
   * Records an action whose destination has not been built.
   *
   * Deliberately observable rather than an empty body: a test can assert that a button
   * is wired to the right destination, which is the half of this that will still be
   * true once the routes exist.
   */
  private _notYetRouted(destination: string): void {
    this.pendingRoutes.update((current) => [...current, destination]);
  }
}
