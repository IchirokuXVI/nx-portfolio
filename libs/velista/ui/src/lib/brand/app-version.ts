import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { APP_VERSION } from '@portfolio/velista/models';

/**
 * Which build of the app this is, said out loud.
 *
 * Plan 0034 D4 already put the version in the bundle and on every gateway request as
 * `x-client-version`, which answers the question for the server. This answers it for
 * the two people that header cannot reach: somebody reporting a problem, and whoever
 * is asking them whether the client actually picked the new bundle up. Both of them
 * are looking at a phone, so the number has to be on the screen.
 *
 * The value is the `APP_VERSION` token and never `environment.version`. That is the
 * extraction contract again (plan 0001, item 6): a library reads a token, and only the
 * app layer knows there is an environment file. It is bound in both run modes, so the
 * portfolio's mounted copy reports the same string as the installed one.
 *
 * ## It is drawn on the screens somebody can reach without an account
 *
 * The landing page, the install page and the join by link page are all reachable while
 * signed out, and the account page is the one place a signed in person already goes to
 * read facts about themselves. Between them there is always a version within reach
 * without signing in, and without putting a build number on a shopping list.
 *
 * ## Nothing is drawn for a version nobody set
 *
 * The token's default is `unknown`, which is the honest answer for anything not built
 * by the app layer, and it is not worth a line of chrome on a page: a spec that renders
 * a page without the app's providers gets nothing rather than a string that reads like
 * a failure. A real build always has one, including `0.0.0-dev` locally and `staging`
 * on the staging fleet, and both are shown exactly as they are. Neither parses as a
 * release version, which is the whole of D6 and is the point: they are not releases,
 * and the screen should not dress them up as one.
 */
@Component({
  selector: 'lib-app-version',
  imports: [RokuTranslatorPipe],
  template: `@if (version(); as build) {
    <span>{{ 'app-version' | rokuT: { version: build } }}</span>
  }`,
  styleUrl: './app-version.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppVersion {
  private readonly _version = inject(APP_VERSION);

  /** The build's name, or null when there is nothing worth showing. */
  readonly version = computed(() => {
    const trimmed = this._version.trim();
    return trimmed === '' || trimmed === 'unknown' ? null : trimmed;
  });
}
