import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ProjectMemory } from '@portfolio/landing-v2/data-access';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { DetailPageShell } from '@portfolio/landing-v2/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

const DAMOCLES_PROJECT_ID = '2';

/** Locale-independent tech chips for the meta panel (0004 content outline). */
const TECH_CHIPS = ['Angular', 'Micro-frontend', 'VR', 'i18n EN/ES/FR'];

/**
 * "A VR game studio, and its site." — Damocle'Sword detail page
 * (`/{locale}/projects/damoclesSword`).
 */
@Component({
  selector: 'lib-landing-v2-damocles-page',
  imports: [DetailPageShell, RokuTranslatorPipe],
  templateUrl: './damocles-page.html',
  styleUrl: './damocles-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DamoclesPage implements OnInit {
  private _projectServ = inject(ProjectMemory);

  readonly techChips = TECH_CHIPS;
  readonly locale = RokuTranslator.getLocale();
  readonly backLink = `/${this.locale}`;

  project = signal<TranslatedProject | null>(null);

  ngOnInit() {
    this._projectServ
      .getById(DAMOCLES_PROJECT_ID, this.locale)
      .subscribe((project) => this.project.set(project));
  }
}
