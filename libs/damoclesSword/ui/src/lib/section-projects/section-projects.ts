import { Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { ProjectCard, ProjectData } from '../project-card/project-card';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-projects',
  imports: [RokuTranslatorPipe, ProjectCard, SectionLayout],
  templateUrl: './section-projects.html',
  styleUrl: './section-projects.scss',
})
export class SectionProjects {
  clientProjects = input<ProjectData[]>([
    {
      kind: 'client-project',
      label: 'VR Sickness Reducer',
      description:
        'section-projects.client-projects-vr-sickness-reducer-description',
      addons: [
        {
          kind: 'video',
          position: 'right',
          src: import('../../../assets/vr-sickness-reducer-demo.mp4').then(
            (module) => module.default
          ),
        },
      ],
    },
    {
      kind: 'client-project',
      label: 'Realistic Interactor',
      description:
        'section-projects.client-projects-realistic-interactor-description',
      addons: [
        {
          kind: 'video',
          position: 'right',
          src: import('../../../assets/realistic-interactor-demo.mp4').then(
            (module) => module.default
          ),
        },
      ],
    },
  ]);

  games = input<ProjectData[]>([
    {
      kind: 'game',
      label: 'STARLIT: ASCENSION',
      description: 'section-projects.games-starlit-ascension-description',
      addons: [
        {
          kind: 'video',
          position: 'right',
          src: import('../../../assets/vr-sickness-reducer-demo.mp4').then(
            (module) => module.default
          ),
        },
        {
          kind: 'image',
          position: 'top-right',
          src: import('../../../assets/starlit-logo.avif').then(
            (module) => module.default
          ),
        },
      ],
    },
  ]);

  get BorderAlignment() {
    return BorderAlignment;
  }
}
