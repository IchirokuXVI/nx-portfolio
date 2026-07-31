import { Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  BorderAlignment,
  DoubleBorderedTitle,
} from '../double-bordered-title/double-bordered-title';

export { BorderAlignment };

@Component({
  selector: 'lib-damocles-sword-section-layout',
  imports: [RokuTranslatorPipe, DoubleBorderedTitle],
  templateUrl: './section-layout.html',
  styleUrl: './section-layout.scss',
})
export class SectionLayout {
  title = input<string | undefined>(undefined);
  borderAlignment = input(BorderAlignment.LEFT);
}
