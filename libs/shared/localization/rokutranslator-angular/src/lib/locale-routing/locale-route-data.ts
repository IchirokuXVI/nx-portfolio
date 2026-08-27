/**
 * Route `data` an app attaches to its own parent route, which is the entire
 * configuration {@link localeGuard} takes. The values come from the same consts the
 * app passes to `provideRokuTranslator`, so an app that gains a locale gains it in
 * one place.
 */
export interface LocaleRouteData {
  /**
   * Key used to persist this app's selected locale, per app
   * (`roku-locale:{appKey}`). Follow the app name, for example `damoclesSword`,
   * `odontogram`, `velista`, and `landingV2` for the app at the site root.
   */
  appKey: string;

  /** Locales this app supports, sourced from its `provideRokuTranslator` config. */
  supportedLocales: readonly string[];

  /** Optional explicit default. Falls back to `supportedLocales[0]` when omitted. */
  defaultLocale?: string;

  /**
   * Where this app is mounted, as a path: `/damoclesSword`, or `''` for the app at
   * the site root and for any app running standalone on its own origin.
   *
   * The locale sits immediately *after* the mount, so this is what tells the guard
   * which segment is the locale. Omitted, it is `''` and the locale is the first
   * segment, which is the shape everything had before app owned routing and which
   * every app under the shell's `:locale` route still has until it migrates.
   *
   * The same value the app provides as its base path (velista's `APP_BASE_PATH`),
   * and it must stay the same value: the guard reading one mount while the locale
   * switcher rewrites at another is a URL that fights itself.
   */
  mountPath?: string;
}
