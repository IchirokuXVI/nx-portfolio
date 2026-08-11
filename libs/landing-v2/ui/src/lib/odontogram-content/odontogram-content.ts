import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DetailPageShell } from '../detail-page-shell/detail-page-shell';

/** Locale-independent tech chips for the meta panel (0004 content outline). */
const TECH_CHIPS = ['Angular', 'SVG'];

/**
 * "A dental chart that models real treatments." — Odontogram detail content,
 * resolved dynamically by `lib-landing-v2-project-page` (feature-project)
 * for `/{locale}/projects/odontogram`. Lives in the ui lib (not a feature-*
 * lib) so it shares the RokuTranslatorModule config already registered by
 * landing-v2-ui-module for every other landingV2 page.
 */
@Component({
  selector: 'lib-landing-v2-odontogram-content',
  imports: [DetailPageShell, RokuTranslatorPipe],
  templateUrl: './odontogram-content.html',
  styleUrl: './odontogram-content.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OdontogramContent {
  project = input.required<TranslatedProject>();

  readonly techChips = TECH_CHIPS;
}
