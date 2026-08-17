import { ODONTOGRAM_AVAILABLE_LOCALES } from '@portfolio/odontogram/ui';

/**
 * The languages odontogram actually enables — the app's choice, owned here in the
 * feature-shell. The UI lib only says which locales it *can* load
 * (`ODONTOGRAM_AVAILABLE_LOCALES`); this list says which are turned on and drives
 * the route-data guard.
 *
 * Defaults to every available locale; restrict here to disable one.
 */
export const ODONTOGRAM_USABLE_LOCALES: string[] = [
  ...ODONTOGRAM_AVAILABLE_LOCALES,
];
