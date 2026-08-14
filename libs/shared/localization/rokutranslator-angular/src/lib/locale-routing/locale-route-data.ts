/**
 * Route `data` contract an app attaches to its top route so the shell's
 * {@link localeCorrectionGuard} can validate the URL locale against that app's
 * own locales before anything renders. The values come from the same const the
 * app passes to `provideRokuTranslator` / `RokuTranslatorModule.withConfig`.
 */
export interface LocaleRouteData {
  /**
   * Key used to persist this app's selected locale, per app
   * (`roku-locale:{appKey}`). Follow the app name, for example `damoclesSword`,
   * `odontogram`, `landingV2`, and `landing` for the root landing app.
   */
  appKey: string;

  /** Locales this app supports, sourced from its `provideRokuTranslator` config. */
  supportedLocales: readonly string[];

  /** Optional explicit default. Falls back to `supportedLocales[0]` when omitted. */
  defaultLocale?: string;
}
