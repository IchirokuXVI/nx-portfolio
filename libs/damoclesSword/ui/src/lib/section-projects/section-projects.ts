import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  BorderAlignment,
  DoubleBorderedTitle,
} from '../double-bordered-title/double-bordered-title';

@Component({
  selector: 'lib-damoclesSword-section-projects',
  imports: [DoubleBorderedTitle, RokuTranslatorPipe],
  templateUrl: './section-projects.html',
  styleUrl: './section-projects.scss',
})
export class SectionProjects {
  get BorderAlignment() {
    return BorderAlignment;
  }
}
