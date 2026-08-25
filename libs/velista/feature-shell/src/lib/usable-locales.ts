import { APP_AVAILABLE_LOCALES } from '@portfolio/velista/ui';

/**
 * The languages this app actually enables — the app's choice, owned here in the
 * feature-shell. The UI lib only says which locales it *can* load
 * (`APP_AVAILABLE_LOCALES`); this list says which are turned on and drives both the
 * route-data guard and the language switcher (which reads it from the route data,
 * so the two always agree).
 *
 * Defaults to every available locale; restrict here to disable one.
 */
export const APP_USABLE_LOCALES: string[] = [...APP_AVAILABLE_LOCALES];
