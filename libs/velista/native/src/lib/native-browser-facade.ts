import { inject, Injectable } from '@angular/core';
import { BrowserFacade } from '@portfolio/velista/platform';
import { NATIVE_PLUGINS } from './native-plugins';

/**
 * The facade with one native difference: an address outside the app opens in a
 * Custom Tab through `@capacitor/browser`, because `window.open` in the WebView
 * depends on settings the shell does not promise. Everything else is inherited.
 */
@Injectable()
export class NativeBrowserFacade extends BrowserFacade {
  private readonly _plugins = inject(NATIVE_PLUGINS);

  override openExternal(url: string): void {
    void this._plugins()
      .then(({ browser }) => browser.open({ url }))
      .catch(() => super.openExternal(url));
  }
}
