import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-future',
  imports: [RokuTranslatorPipe, SectionLayout],
  templateUrl: './section-future.html',
  styleUrl: './section-future.scss',
})
export class SectionFuture {
  get BorderAlignment() {
    return BorderAlignment;
  }
}
