import { inject, Injectable } from '@angular/core';
import type { AppTheme } from '@portfolio/velista/models';
import { type SystemBarsI, WebSystemBars } from '@portfolio/velista/platform';
import { NATIVE_PLUGINS } from './native-plugins';

/**
 * The Android status bar's icons, following the theme.
 *
 * Edge to edge, the bar has no colour of its own: the page header paints the ground
 * beneath it. Only the icons need to change, light on Night and dark on Day. The web
 * meta is still written, so the WebView's own idea of the theme colour agrees.
 */
@Injectable({ providedIn: 'root' })
export class NativeSystemBars implements SystemBarsI {
  private readonly _plugins = inject(NATIVE_PLUGINS);
  private readonly _web = inject(WebSystemBars);

  apply(theme: AppTheme): void {
    this._web.apply(theme);
    void this._plugins()
      .then(({ systemBars }) =>
        systemBars.setStyle({ style: theme === 'night' ? 'DARK' : 'LIGHT' })
      )
      // A bar left in the other style is cosmetic, and nothing here can retry it.
      .catch(() => undefined);
  }
}
