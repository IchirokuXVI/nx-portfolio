import { Component, signal } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import patreonIcon from '../../../assets/patreon-icon.svg';

@Component({
  selector: 'lib-damocles-sword-section-contact-support',
  imports: [RokuTranslatorPipe],
  templateUrl: './section-contact-support.html',
  styleUrl: './section-contact-support.scss',
})
export class SectionContactSupport {
  /** Existing project Patreon icon, reused from the footer assets. */
  patreonIcon = patreonIcon;
  /** Same Patreon URL used by the footer. */
  patreonUrl = 'https://www.patreon.com/profile/creators?u=162538734';

  readonly email = signal('');
  readonly subscribed = signal(false);

  /**
   * Mocked subscription: no request is sent for now. When a non-empty email is
   * submitted we surface the "subscription completed" message and clear the input.
   */
  subscribe() {
    if (!this.email().trim()) {
      return;
    }

    this.subscribed.set(true);
    this.email.set('');
  }
}
