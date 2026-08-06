import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { SectionLayout } from '../section-layout/section-layout';

/** A single tag chip: both keys are translated in the template. */
interface DetailedProjectTag {
  labelKey: string;
  valueKey: string;
}

/** Static shape for a detailed project card (all copy via i18n keys). */
interface DetailedProject {
  titleKey: string;
  descriptionKey: string;
  tags: DetailedProjectTag[];
}

@Component({
  selector: 'lib-damocles-sword-section-projects-detailed',
  imports: [RokuTranslatorPipe, SectionLayout],
  templateUrl: './section-projects-detailed.html',
  styleUrl: './section-projects-detailed.scss',
})
export class SectionProjectsDetailed {
  get BorderAlignment() {
    return BorderAlignment;
  }

  /** Kept as static component data (no data-access domain needed yet). */
  readonly projects: DetailedProject[] = [
    {
      titleKey: 'section-projects-detailed.realistic-interactor-title',
      descriptionKey:
        'section-projects-detailed.realistic-interactor-description',
      tags: [
        {
          labelKey: 'section-projects-detailed.tag-platform-label',
          valueKey: 'section-projects-detailed.realistic-interactor-platform',
        },
        {
          labelKey: 'section-projects-detailed.tag-engine-label',
          valueKey: 'section-projects-detailed.realistic-interactor-engine',
        },
        {
          labelKey: 'section-projects-detailed.tag-sector-label',
          valueKey: 'section-projects-detailed.realistic-interactor-sector',
        },
        {
          labelKey: 'section-projects-detailed.tag-experience-label',
          valueKey: 'section-projects-detailed.realistic-interactor-experience',
        },
      ],
    },
    {
      titleKey: 'section-projects-detailed.vr-sickness-reducer-title',
      descriptionKey:
        'section-projects-detailed.vr-sickness-reducer-description',
      tags: [
        {
          labelKey: 'section-projects-detailed.tag-platform-label',
          valueKey: 'section-projects-detailed.vr-sickness-reducer-platform',
        },
        {
          labelKey: 'section-projects-detailed.tag-engine-label',
          valueKey: 'section-projects-detailed.vr-sickness-reducer-engine',
        },
        {
          labelKey: 'section-projects-detailed.tag-sector-label',
          valueKey: 'section-projects-detailed.vr-sickness-reducer-sector',
        },
        {
          labelKey: 'section-projects-detailed.tag-experience-label',
          valueKey: 'section-projects-detailed.vr-sickness-reducer-experience',
        },
      ],
    },
  ];
}
