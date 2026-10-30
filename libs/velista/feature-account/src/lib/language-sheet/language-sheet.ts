import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath, SheetNavigation } from '@portfolio/velista/platform';
import {
  APP_AVAILABLE_LOCALES,
  localeName,
  SheetShell,
} from '@portfolio/velista/ui';

/** One radio row of the sheet. */
export interface LanguageChoiceVm {
  readonly locale: string;
  /** The language's own name, which is what makes it findable (`APP_LOCALE_NAMES`). */
  readonly name: string;
  readonly selected: boolean;
}

/**
 * Which language the app is in, from inside the app.
 *
 * Before this sheet the only switch was on the public landing page, so an installed
 * app could change language only by signing out.
 *
 * **A press picks, switches and closes.** No Save button: there is one value, and a
 * radio that needs a second press to count is a radio people leave unsaved. The same
 * shape as `LineSupermarketSheet`.
 *
 * The locales are the usable ones the `AppLayout` route carries in its data, read from
 * the route rather than imported: the constant lives in `feature-shell`, which lazily
 * imports this library, so importing it back would close a cycle in the project graph.
 */
@Component({
  selector: 'lib-language-sheet',
  imports: [RokuTranslatorPipe, SheetShell],
  templateUrl: './language-sheet.html',
  styleUrl: './language-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguageSheet {
  private readonly _sheet = inject(SheetNavigation);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);

  /** True once a press has started the navigation, so a second one waits. */
  readonly leaving = signal(false);

  private readonly _supported = supportedLocales(this._route);

  readonly choices = computed<readonly LanguageChoiceVm[]>(() => {
    const current = this._locale();
    return this._supported.map((locale) => ({
      locale,
      name: localeName(locale),
      selected: locale === current,
    }));
  });

  /**
   * A press on the row that is already the answer, which changes no radio and so
   * fires no `change`. It closes the sheet, as any other row does.
   *
   * It returns nothing on purpose: a listener that answers false cancels the click,
   * and a cancelled click on a radio never checks it.
   */
  pressed(choice: LanguageChoiceVm): void {
    if (choice.selected) {
      void this.pick(choice.locale);
    }
  }

  /**
   * A row was picked: switch to it and close, in one navigation.
   *
   * `leaveTo` the account page addressed in the new locale, and **not**
   * `RokuLocaleStore.switchAppLocale`. That one pushes a new entry for the current URL
   * with its locale segment rewritten, which here is the sheet's URL: the sheet would
   * stay open, and closing it would then pop back onto the sheet in the old language.
   * `leaveTo` replaces the sheet's own entry instead, and the `localeGuard` on the
   * `AppLayout` route re-runs on a changed locale segment, so it is the guard that
   * calls `changeLocale` and persists the choice, as it does for any arrival.
   *
   * The browser's back button after a switch returns to the account page in the
   * previous language, and the guard adopts that language again. The landing switch
   * and `switchAppLocale` behave the same everywhere, so this matches them.
   */
  async pick(locale: string): Promise<void> {
    if (this.leaving()) {
      return;
    }

    if (locale === this._locale()) {
      await this.dismiss();
      return;
    }

    this.leaving.set(true);
    try {
      await this._sheet.leaveTo(appPath(locale, this._basePath, 'account'));
    } finally {
      this.leaving.set(false);
    }
  }

  /** Cancel, Escape, the scrim, and the back button all arrive here. */
  async dismiss(): Promise<void> {
    await this._sheet.dismiss(
      appPath(this._locale(), this._basePath, 'account')
    );
  }
}

/**
 * The usable locales from the route data above this sheet, merged root first the way
 * `localeGuard` reads them, so the nearest route that names them wins. Falls back to
 * every locale the UI ships when no route names any, which is a spec with no routes.
 */
function supportedLocales(route: ActivatedRoute): readonly string[] {
  let found: readonly string[] | undefined;
  for (const ancestor of route.snapshot?.pathFromRoot ?? []) {
    const locales = ancestor.data?.['supportedLocales'] as
      | readonly string[]
      | undefined;
    if (locales !== undefined) {
      found = locales;
    }
  }
  return found ?? APP_AVAILABLE_LOCALES;
}
