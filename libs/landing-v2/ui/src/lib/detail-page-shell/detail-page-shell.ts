import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ArrowIcon, GithubIcon } from '@portfolio/shared/ui';

/**
 * Reusable shell for the three project detail pages (0004): a header (title +
 * tagline + repo/live-app links), an optional hero visual, and two projected
 * slots — `[body]` for the prose sections, `[meta]` for the tech/facts side
 * panel. Same dark tokens + gold accent as the landing page
 * (libs/landing-v2/ui/src/lib/styles/_variables).
 *
 * The shared `Layout` provides the site header (with the language switch and a
 * brand link home) and footer around this, so the shell no longer carries its
 * own top bar or back link.
 */
@Component({
  selector: 'lib-landing-v2-detail-page-shell',
  imports: [AsyncPipe, RouterLink, RokuTranslatorPipe, ArrowIcon, GithubIcon],
  templateUrl: './detail-page-shell.html',
  styleUrl: './detail-page-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailPageShell {
  title = input.required<string>();
  tagline = input<string | undefined>(undefined);
  heroImage = input<string | Promise<string> | undefined>(undefined);
  repoLink = input<string | undefined>(undefined);
  appLink = input<string | undefined>(undefined);

  /** Normalizes `heroImage` to always be a promise, so the template can rely
   * on a single `| async` binding (mirrors project-card's `imagePromise`). */
  readonly resolvedHeroImage = computed<Promise<string> | undefined>(() => {
    const image = this.heroImage();

    if (image === undefined) {
      return undefined;
    }

    return typeof image === 'string' ? Promise.resolve(image) : image;
  });
}
