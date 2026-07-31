import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import sectionVisionAddon from '../../../assets/section-vision-addon.avif';
import { BorderAlignment } from '../border-alignment/border-alignment';
import { CallToActionButton } from '../call-to-action-button/call-to-action-button';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-our-vision',
  imports: [RokuTranslatorPipe, CallToActionButton, SectionLayout],
  templateUrl: './section-our-vision.html',
  styleUrl: './section-our-vision.scss',
})
export class SectionOurVision {
  sectionVisionAddon = sectionVisionAddon;

  get BorderAlignment() {
    return BorderAlignment;
  }
}
