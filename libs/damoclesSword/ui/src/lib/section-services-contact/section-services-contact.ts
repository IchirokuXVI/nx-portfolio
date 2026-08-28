import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ContactForm } from '../contact-form/contact-form';
import { DoubleBorderedTitle } from '../double-bordered-title/double-bordered-title';
import { SectionLayout } from '../section-layout/section-layout';

@Component({
  selector: 'lib-damocles-sword-section-services-contact',
  imports: [
    RokuTranslatorPipe,
    SectionLayout,
    ContactForm,
    DoubleBorderedTitle,
  ],
  templateUrl: './section-services-contact.html',
  styleUrl: './section-services-contact.scss',
})
export class SectionServicesContact {}
