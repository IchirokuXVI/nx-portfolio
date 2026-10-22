import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { AppUpdates } from '@portfolio/velista/platform';
import { SpinnerIcon } from '@portfolio/velista/ui';

/** How long the page draws nothing, so a quick answer never flashes a status. */
export const NOT_FOUND_QUIET_MS = 300;

/** How long the page waits for an answer before it draws the 404 anyway. */
export const NOT_FOUND_CHECK_LIMIT_MS = 10_000;

/** What the page draws, in the order it can draw them. */
export type NotFoundFace = 'quiet' | 'checking' | 'updating' | 'missing';

/**
 * The page for a URL no route matched (plan 0150).
 *
 * **It asks for a newer version before it says 404.** An installed app runs the
 * bundle its service worker cached, and a link from a newer release, a password
 * reset mail for one, can name a route this bundle does not have. The newer version
 * downloads in the background and would take over at the next navigation, which
 * leaves the link behind. So this page asks first, and when a version is ready it
 * reloads on the same URL, where the newer bundle draws the real page.
 *
 * One reload per URL per tab, kept by `AppUpdates`. The reloaded document asks
 * again, hears that nothing newer exists, and draws the 404.
 *
 * An answer that comes after the limit still reloads, because the person is still on
 * a page that a newer version may draw. A page already left never reloads.
 */
@Component({
  selector: 'lib-not-found-page',
  imports: [RokuTranslatorPipe, SpinnerIcon],
  templateUrl: './not-found-page.html',
  styleUrl: './not-found-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {
  private readonly _updates = inject(AppUpdates);
  private readonly _router = inject(Router);

  readonly face = signal<NotFoundFace>('quiet');

  constructor() {
    // Built while its own navigation is still running, so `router.url` may still be
    // the previous page. The navigation's final URL is the one the reload must keep.
    const navigation = this._router.currentNavigation();
    const url = navigation
      ? this._router.serializeUrl(
          navigation.finalUrl ?? navigation.extractedUrl
        )
      : this._router.url;

    let destroyed = false;
    const quiet = setTimeout(() => {
      if (this.face() === 'quiet') {
        this.face.set('checking');
      }
    }, NOT_FOUND_QUIET_MS);
    const limit = setTimeout(() => {
      if (this.face() !== 'updating') {
        this.face.set('missing');
      }
    }, NOT_FOUND_CHECK_LIMIT_MS);

    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      clearTimeout(quiet);
      clearTimeout(limit);
    });

    void this._updates.newerVersionForUnknownPage(url).then((newer) => {
      if (destroyed) {
        return;
      }
      clearTimeout(quiet);
      clearTimeout(limit);

      if (!newer) {
        this.face.set('missing');
        return;
      }

      this.face.set('updating');
      this._updates.reloadForUnknownPage(url);
    });
  }
}
