import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-who-we-are',
  imports: [RokuTranslatorPipe, SectionLayout],
  templateUrl: './section-who-we-are.html',
  styleUrl: './section-who-we-are.scss',
})
export class SectionWhoWeAre {
  get BorderAlignment() {
    return BorderAlignment;
  }
}
