import { computed, inject, Injectable, type Signal, signal } from '@angular/core';
import {
  APP_BRAND,
  type AppTheme,
  appThemeClass,
  type AppThemePreference,
  isAppThemePreference,
} from '@portfolio/velista/models';
import { BrowserFacade } from './browser-facade';
import { StorageKeys } from './storage-keys';

/**
 * Where the user's theme choice is persisted. Namespaced by the Nx project name,
 * which is a technical identifier stable across a rename, never the product name
 * (rule N1).
 *
 * Defined in `StorageKeys` rather than here, so every key this app writes sits in one
 * place and shares one convention. Re-exported because this is the name the theme
 * tests and any settings screen already reach for.
 */
export const THEME_STORAGE_KEY = StorageKeys.theme;

/**
 * Asked as `light` rather than `dark` on purpose. `BrowserFacade.matchMedia`
 * answers false wherever it cannot answer at all, whether that is a server
 * render, a test environment or a browser without `matchMedia`. Phrasing the
 * query this way therefore makes Night the fallback for free, which is the third
 * and last step of the resolution order below.
 */
const PREFERS_LIGHT = '(prefers-color-scheme: light)';

/**
 * The active theme, and the user's choice about it (plan 0002, section 4.5).
 *
 * Resolution order, first match wins:
 *
 * 1. an explicit user choice from settings, persisted;
 * 2. the operating system, via `prefers-color-scheme`;
 * 3. Night.
 *
 * Every browser API involved is reached through `BrowserFacade`, never directly
 * (plan 0001, D2): `localStorage` and `matchMedia` are both server hostile, and
 * the standalone SSR build has to keep working. Reading the stored value in the
 * constructor is safe for the same reason, since the facade degrades to null
 * there rather than throwing, and it matters that it happens at construction
 * rather than on first render, so the first paint is already the right theme.
 */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  /**
   * What the user asked for. `system` is the absence of a choice and is the
   * default, because most people never open the setting and following the device
   * is the right behaviour for them.
   */
  readonly preference: Signal<AppThemePreference>;

  /** What they actually get, after the resolution order above. */
  readonly theme: Signal<AppTheme>;

  /** The class the app root carries. This is the entire theming mechanism. */
  readonly themeClass: Signal<string>;

  /**
   * True when the brand pins a theme, in which case the preference is inert and
   * a settings screen should not offer the choice.
   *
   * `AppBrand.themeClass` exists so a rebrand can ship a palette along with the
   * name (section 5). A brand that ships one palette means one palette, so it
   * overrides the whole resolution rather than only the default. Otherwise a
   * user whose device reports light would land on a `theme-day` the rebrand never
   * defined. It is unset today; Night and Day are both reachable.
   */
  readonly isPinned: boolean;

  private readonly _browser = inject(BrowserFacade);
  private readonly _brand = inject(APP_BRAND);
  private readonly _preference = signal<AppThemePreference>('system');

  constructor() {
    const stored = this._browser.readStorage(THEME_STORAGE_KEY);
    if (isAppThemePreference(stored)) {
      this._preference.set(stored);
    }

    const prefersLight = this._browser.matchMedia(PREFERS_LIGHT);

    this.preference = this._preference.asReadonly();
    this.theme = computed(() => {
      const chosen = this._preference();
      if (chosen !== 'system') {
        return chosen;
      }
      return prefersLight() ? 'day' : 'night';
    });

    this.isPinned = this._brand.themeClass != null;
    const pinned = this._brand.themeClass;
    this.themeClass = computed(() => pinned ?? appThemeClass(this.theme()));
  }

  /**
   * Record an explicit choice, or hand control back to the device with `system`.
   *
   * The write is fire and forget: the facade swallows a storage failure, and
   * nothing here is load bearing enough to fail a user action over. The theme
   * still changes for this session either way, which is the part the user asked
   * for.
   */
  setPreference(preference: AppThemePreference): void {
    this._preference.set(preference);
    this._browser.writeStorage(THEME_STORAGE_KEY, preference);
  }
}
