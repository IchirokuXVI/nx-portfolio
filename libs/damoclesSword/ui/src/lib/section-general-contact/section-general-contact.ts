import { Component } from '@angular/core';
import { ContactForm } from '../contact-form/contact-form';
import { SectionLayout } from '../section-layout/section-layout';

/**
 * General contact band (dark, no section title). Renders the shared
 * {@link ContactForm} with all defaults — the default "Contact Us" heading and
 * the default send button — demonstrating the no-slot path.
 */
@Component({
  selector: 'lib-damocles-sword-section-general-contact',
  imports: [SectionLayout, ContactForm],
  templateUrl: './section-general-contact.html',
  styleUrl: './section-general-contact.scss',
})
export class SectionGeneralContact {}
