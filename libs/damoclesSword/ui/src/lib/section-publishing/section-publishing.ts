import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { MetaIcon, SteamIcon } from '@portfolio/shared/ui';
import { ContactForm } from '../contact-form/contact-form';
import { DoubleBorderedTitle } from '../double-bordered-title/double-bordered-title';
import { BorderAlignment } from '../enums/border-alignment';
import { SectionLayout } from '../section-layout/section-layout';

/**
 * "Looking For Publishing" band (dark). Presents the game currently seeking
 * funding alongside the shared {@link ContactForm} — the form heading is
 * overridden with the game name via the `[contact-form-title]` slot. The card
 * platforms reuse the shared Meta / Steam icons from `@portfolio/shared/ui`.
 */
@Component({
  selector: 'lib-damocles-sword-section-publishing',
  imports: [
    RokuTranslatorPipe,
    SectionLayout,
    ContactForm,
    DoubleBorderedTitle,
    MetaIcon,
    SteamIcon,
  ],
  templateUrl: './section-publishing.html',
  styleUrl: './section-publishing.scss',
})
export class SectionPublishing {
  get BorderAlignment() {
    return BorderAlignment;
  }
}
