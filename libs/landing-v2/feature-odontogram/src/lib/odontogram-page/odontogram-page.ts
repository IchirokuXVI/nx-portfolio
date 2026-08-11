import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ProjectMemory } from '@portfolio/landing-v2/data-access';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { DetailPageShell } from '@portfolio/landing-v2/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

const ODONTOGRAM_PROJECT_ID = '3';

/** Locale-independent tech chips for the meta panel (0004 content outline). */
const TECH_CHIPS = ['Angular', 'SVG'];

/**
 * "A dental chart that models real treatments." — Odontogram detail page
 * (`/{locale}/projects/odontogram`).
 */
@Component({
  selector: 'lib-landing-v2-odontogram-page',
  imports: [DetailPageShell, RokuTranslatorPipe],
  templateUrl: './odontogram-page.html',
  styleUrl: './odontogram-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OdontogramPage implements OnInit {
  private _projectServ = inject(ProjectMemory);

  readonly techChips = TECH_CHIPS;
  readonly locale = RokuTranslator.getLocale();
  readonly backLink = `/${this.locale}`;

  project = signal<TranslatedProject | null>(null);

  ngOnInit() {
    this._projectServ
      .getById(ODONTOGRAM_PROJECT_ID, this.locale)
      .subscribe((project) => this.project.set(project));
  }
}
