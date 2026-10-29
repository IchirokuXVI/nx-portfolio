import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * The two legal documents, as a quiet row of text (velista `0172`, target 7).
 *
 * One component for the five screens that draw it (D6): the account page, sign in,
 * register, upgrade and the front door. The copy and the order must not drift between
 * them, and Google's review looks for the policy link on the page it is pointed at.
 *
 * Presentational: the container builds both addresses with `appPath`, so this knows
 * neither the locale nor the mount. Each link is a touch target tall even though its
 * text is small, because it sits at the foot of a screen in thumb reach.
 */
@Component({
  selector: 'lib-legal-links',
  imports: [RokuTranslatorPipe, RouterLink],
  template: `
    <nav [attr.aria-label]="'legal.links' | rokuT" class="links">
      <a [routerLink]="privacyUrl()" class="link">{{
        'legal.link.privacy' | rokuT
      }}</a>
      <a [routerLink]="termsUrl()" class="link">{{
        'legal.link.terms' | rokuT
      }}</a>
    </nav>
  `,
  styleUrl: './legal-links.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalLinks {
  /** The privacy policy's address in this app, from `appPath`. */
  readonly privacyUrl = input.required<string>();

  /** The terms' address in this app, from `appPath`. */
  readonly termsUrl = input.required<string>();
}
