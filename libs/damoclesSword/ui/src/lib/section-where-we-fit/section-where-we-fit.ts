import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import servicesCulturalProject from '../../../assets/services-cultural-project.png';
import servicesGamification from '../../../assets/services-gamification.png';
import servicesTechnology from '../../../assets/services-technology.png';
import servicesTraining from '../../../assets/services-training.png';
import { BorderAlignment } from '../enums/border-alignment';
import { InfoCard } from '../info-card/info-card';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-where-we-fit',
  imports: [RokuTranslatorPipe, SectionLayout, InfoCard],
  templateUrl: './section-where-we-fit.html',
  styleUrl: './section-where-we-fit.scss',
})
export class SectionWhereWeFit {
  readonly servicesTechnology = servicesTechnology;
  readonly servicesCulturalProject = servicesCulturalProject;
  readonly servicesTraining = servicesTraining;
  readonly servicesGamification = servicesGamification;

  get BorderAlignment() {
    return BorderAlignment;
  }
}
