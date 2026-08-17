import { LANDING_V2_AVAILABLE_LOCALES } from '@portfolio/landing-v2/ui';

/**
 * The languages landingV2 actually enables — the app's choice, owned here in the
 * feature-shell. The UI lib only says which locales it *can* load
 * (`LANDING_V2_AVAILABLE_LOCALES`); this list says which are turned on and drives
 * both the route-data guard and the language switcher (which reads it from the
 * route data, so it always matches this list).
 *
 * Defaults to every available locale; restrict here to disable one.
 */
export const LANDING_V2_USABLE_LOCALES: string[] = [
  ...LANDING_V2_AVAILABLE_LOCALES,
];
