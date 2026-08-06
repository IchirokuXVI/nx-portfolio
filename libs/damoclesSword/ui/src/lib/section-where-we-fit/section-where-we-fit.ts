import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
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
  get BorderAlignment() {
    return BorderAlignment;
  }
}
