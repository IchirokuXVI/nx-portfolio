import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ProjectCard } from '../project-card/project-card';

/**
 * Dynamic 2-col project grid (brief #3, #4): no hardcoded cards, no "x / y"
 * counter next to the title, and each project's `visual.columnSpan` decides
 * whether its card spans the full grid width.
 */
@Component({
  selector: 'lib-landing-v2-project-grid',
  imports: [RokuTranslatorPipe, ProjectCard],
  templateUrl: './project-grid.html',
  styleUrl: './project-grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectGrid {
  projects = input<TranslatedProject[]>([]);
}
