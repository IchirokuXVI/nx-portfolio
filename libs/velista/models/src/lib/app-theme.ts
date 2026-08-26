/**
 * The two themes (plan 0002, section 4). Both are first class: the app is used in
 * a dim kitchen and in a bright supermarket routinely, so this is not a light
 * theme bolted on later, and the mock for every page is checked in both.
 *
 * The names describe **the lighting the user is in**, not a brand, so no rename
 * can make them wrong (rule N1, and section 5.2).
 */
export type AppTheme = 'night' | 'day';

/** Every theme, in the order a settings screen should offer them. */
export const APP_THEMES: readonly AppTheme[] = ['night', 'day'];

/**
 * What the user asked for, which is not the same as what they get. `system` is
 * the absence of a choice, and it is the default: most people never open the
 * setting, and following the device is the right behaviour for them.
 */
export type AppThemePreference = AppTheme | 'system';

/** Every preference a settings screen can offer, `system` first because it is the default. */
export const APP_THEME_PREFERENCES: readonly AppThemePreference[] = [
  'system',
  ...APP_THEMES,
];

/**
 * The class a theme is applied with. A theme is a class on the app root that
 * redefines the semantic colour layer and nothing else, so this one function is
 * the whole binding between the model and the stylesheet.
 */
export function appThemeClass(theme: AppTheme): string {
  return `theme-${theme}`;
}

/** Narrows an untrusted string, such as one read back out of storage. */
export function isAppThemePreference(
  value: string | null
): value is AppThemePreference {
  return value === 'system' || APP_THEMES.includes(value as AppTheme);
}
