import { computed, inject, type Signal } from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { OperatorSettingsStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  APP_RUNTIME,
  appPath,
  sheetSegments,
} from '@portfolio/velista/platform';

/** What a credential screen needs to know about the terms (velista `0173`). */
export interface AuthTerms {
  /**
   * The terms as a sheet over this screen, or null when the deployment published no
   * terms (or has not said yet), in which case nothing about them is drawn (target 9).
   */
  readonly termsUrl: Signal<string | null>;
  /** The privacy policy as a sheet over this screen, or null on the same terms. */
  readonly privacyUrl: Signal<string | null>;
  /**
   * Whether to draw the Google button: the deployment has a Google client, and this is
   * not the native shell, where Google refuses an embedded WebView.
   */
  readonly googleOffered: Signal<boolean>;
  /**
   * The version a press accepts, read at the moment of the press, or null when there
   * are no terms to accept.
   */
  readonly version: () => string | null;
  /** Read the settings again, after the server said the version moved. */
  readonly reload: () => void;
}

/**
 * The terms as sign in, register and upgrade read them: one place, so the three
 * screens cannot disagree about when the checkbox, the lines and Google are drawn.
 *
 * Call it in an injection context with the screen's own path after the locale
 * (`['auth', 'register']`): the documents open as sheets over it (target 6, D5), so
 * nothing typed into the form is lost.
 */
export function authTerms(over: readonly string[]): AuthTerms {
  const settings = inject(OperatorSettingsStore);
  const locale = inject(RokuLocaleStore).locale;
  const basePath = inject(APP_BASE_PATH);
  const native = inject(APP_RUNTIME) === 'native';

  const published = computed(() => settings.settings()?.published === true);
  const sheet = (kind: 'privacy' | 'terms') =>
    computed(() =>
      published()
        ? appPath(locale(), basePath, ...over, ...sheetSegments(kind))
        : null
    );

  return {
    termsUrl: sheet('terms'),
    privacyUrl: sheet('privacy'),
    googleOffered: computed(
      () => !native && settings.settings()?.features.googleSignIn === true
    ),
    version: () => {
      const current = settings.settings();
      return current?.published === true ? current.terms.version : null;
    },
    reload: () => settings.reload(),
  };
}
