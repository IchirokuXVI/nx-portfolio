import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import aboutValueCuriosity from '../../../assets/about-value-curiosity.png';
import aboutValueQuality from '../../../assets/about-value-quality.png';
import aboutValueRespect from '../../../assets/about-value-respect.png';
import aboutValueResponsibility from '../../../assets/about-value-responsibility.png';
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
      image: aboutValueQuality,
    },
    {
      title: 'section-our-values.responsibility-title',
      description: 'section-our-values.responsibility-description',
      image: aboutValueResponsibility,
    },
    {
      title: 'section-our-values.respect-title',
      description: 'section-our-values.respect-description',
      image: aboutValueRespect,
    },
    {
      title: 'section-our-values.curiosity-title',
      description: 'section-our-values.curiosity-description',
      image: aboutValueCuriosity,
    },
  ];

  get BorderAlignment() {
    return BorderAlignment;
  }
}
