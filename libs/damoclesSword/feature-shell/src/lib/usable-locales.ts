import { DAMOCLES_AVAILABLE_LOCALES } from '@portfolio/damoclesSword/ui';

/**
 * The languages damoclesSword actually enables — the app's choice, owned here in
 * the feature-shell rather than in the UI lib. The UI lib only says which locales
 * it *can* load (`DAMOCLES_AVAILABLE_LOCALES`); this list says which are turned
 * on, and drives both the route-data guard and the language switcher.
 *
 * Defaults to every available locale. To disable one, restrict here, for example
 * `DAMOCLES_AVAILABLE_LOCALES.filter((l) => l !== 'fr')`.
 */
export const DAMOCLES_USABLE_LOCALES: string[] = [...DAMOCLES_AVAILABLE_LOCALES];
