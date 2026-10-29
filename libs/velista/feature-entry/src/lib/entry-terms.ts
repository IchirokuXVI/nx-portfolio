import { computed, inject, type Signal } from '@angular/core';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { OperatorSettingsStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath } from '@portfolio/velista/platform';

/** What a screen that can make a guest account needs about the terms (velista `0173`). */
export interface EntryTerms {
  /**
   * The terms' page, or null when the deployment published none, in which case the
   * notice is not drawn and no version is sent (target 9). The page and not a sheet:
   * a sheet over a sheet is not a pattern this app has, and the only thing typed here
   * is a short name (D5).
   */
  readonly termsUrl: Signal<string | null>;
  /** The version a press accepts, read at the moment of the press, or null. */
  readonly version: () => string | null;
  /** Read the settings again, after the server said the version moved. */
  readonly reload: () => void;
}

/**
 * The terms as the three entry screens read them: create a group, join with a code,
 * and join from a link. Call it in an injection context.
 */
export function entryTerms(): EntryTerms {
  const settings = inject(OperatorSettingsStore);
  const locale = inject(RokuLocaleStore).locale;
  const basePath = inject(APP_BASE_PATH);

  return {
    termsUrl: computed(() =>
      settings.settings()?.published === true
        ? appPath(locale(), basePath, 'terms')
        : null
    ),
    version: () => {
      const current = settings.settings();
      return current?.published === true ? current.terms.version : null;
    },
    reload: () => settings.reload(),
  };
}

/** Whether a sentence the screen drew is a refusal about the terms. */
export function isTermsSentence(key: string | null): boolean {
  return key === 'legal.accept.stale' || key === 'legal.accept.missing';
}
