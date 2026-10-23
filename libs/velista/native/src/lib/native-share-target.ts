import { inject, Injectable } from '@angular/core';
import type {
  ShareOutcome,
  ShareTargetData,
  ShareTargetI,
} from '@portfolio/velista/platform';
import { NATIVE_PLUGINS } from './native-plugins';

/**
 * Android's share sheet through `@capacitor/share`, because the WebView has no Web
 * Share (inventory 2.3) and every share would otherwise fall back to copying.
 *
 * No user gesture is needed natively, so the `await` before the call costs nothing.
 */
@Injectable({ providedIn: 'root' })
export class NativeShareTarget implements ShareTargetI {
  private readonly _plugins = inject(NATIVE_PLUGINS);

  canShare(): boolean {
    return true;
  }

  async share(data: ShareTargetData): Promise<ShareOutcome> {
    try {
      const { share } = await this._plugins();
      await share.share({ ...data });
      return 'shared';
    } catch (error: unknown) {
      return isCancel(error) ? 'dismissed' : 'unavailable';
    }
  }
}

/**
 * The plugin rejects a closed chooser with the message "Share canceled", and with
 * nothing more specific, so the message is what tells a dismissal from a failure.
 */
function isCancel(error: unknown): boolean {
  const message =
    typeof error === 'object' && error !== null
      ? (error as { message?: unknown }).message
      : undefined;
  return typeof message === 'string' && /cancel/i.test(message);
}
