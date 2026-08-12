import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import servicesHandshake from '../../../assets/services-handshake.png';
import servicesLightbulb from '../../../assets/services-lightbulb.png';
import servicesVrHeadset from '../../../assets/services-vr-headset.png';
import { BorderAlignment } from '../enums/border-alignment';
import { InfoCard } from '../info-card/info-card';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-what-we-do',
  imports: [RokuTranslatorPipe, SectionLayout, InfoCard],
  templateUrl: './section-what-we-do.html',
  styleUrl: './section-what-we-do.scss',
})
export class SectionWhatWeDo {
  readonly servicesHandshake = servicesHandshake;
  readonly servicesLightbulb = servicesLightbulb;
  readonly servicesVrHeadset = servicesVrHeadset;

  get BorderAlignment() {
    return BorderAlignment;
  }
}
