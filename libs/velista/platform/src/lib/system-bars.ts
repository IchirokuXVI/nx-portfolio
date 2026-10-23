import { inject, Injectable, InjectionToken } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import type { AppTheme } from '@portfolio/velista/models';

/**
 * The ground colour of each theme, which is what the top bar paints
 * (`--app-surface-ground` in `_themes.scss`: `--app-ink-950` for Night,
 * `--app-neutral-50` for Day).
 *
 * The status bar takes the same colour so the bar and the app above the header read as
 * one surface. A literal here because a meta tag and a native status bar cannot read a
 * CSS custom property; `system-bars.spec.ts` holds it to the stylesheet.
 */
export const THEME_GROUND_COLORS: Readonly<Record<AppTheme, string>> = {
  night: '#0a0c14',
  day: '#f7f8fc',
};

/** The system's own bars around the app: the status bar, and later the navigation bar. */
export interface SystemBarsI {
  apply(theme: AppTheme): void;
}

/**
 * The browser's half: the `theme-color` meta, which Chrome on Android and an installed
 * PWA paint the status bar from.
 *
 * Through Angular's `Meta`, the sanctioned way into `<head>` (SSR rule 5), so a server
 * render writes the same tag into the document it sends. The static tag in
 * `index.html` stays as the first paint; this corrects it (D6).
 */
@Injectable({ providedIn: 'root' })
export class WebSystemBars implements SystemBarsI {
  private readonly _meta = inject(Meta);

  apply(theme: AppTheme): void {
    this._meta.updateTag({
      name: 'theme-color',
      content: THEME_GROUND_COLORS[theme],
    });
  }
}

/** The bars `ThemeStore` paints. The meta tag by default; a native shell provides its own. */
export const SYSTEM_BARS = new InjectionToken<SystemBarsI>('SYSTEM_BARS', {
  providedIn: 'root',
  factory: () => inject(WebSystemBars),
});
