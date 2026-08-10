import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { InfoCard } from '../info-card/info-card';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-our-values',
  imports: [RokuTranslatorPipe, InfoCard, SectionLayout],
  templateUrl: './section-our-values.html',
  styleUrl: './section-our-values.scss',
})
export class SectionOurValues {
  readonly values = [
    {
      title: 'section-our-values.quality-title',
      description: 'section-our-values.quality-description',
    },
    {
      title: 'section-our-values.responsibility-title',
      description: 'section-our-values.responsibility-description',
    },
    {
      title: 'section-our-values.respect-title',
      description: 'section-our-values.respect-description',
    },
    {
      title: 'section-our-values.curiosity-title',
      description: 'section-our-values.curiosity-description',
    },
  ];

  get BorderAlignment() {
    return BorderAlignment;
  }
}
