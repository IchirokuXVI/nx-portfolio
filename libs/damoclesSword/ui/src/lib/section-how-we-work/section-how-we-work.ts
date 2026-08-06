import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-how-we-work',
  imports: [RokuTranslatorPipe, SectionLayout],
  templateUrl: './section-how-we-work.html',
  styleUrl: './section-how-we-work.scss',
})
export class SectionHowWeWork {
  get BorderAlignment() {
    return BorderAlignment;
  }
}
