import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { GoogleIcon } from '../icons/icons';

/**
 * The other way in, under a divider: Continue with Google.
 *
 * The divider comes with it rather than being written out by each screen, because the
 * button is never shown without one and the two are one idea: everything above is the
 * form, and this is the alternative to filling it in.
 *
 * ## It is drawn here, not by Google
 *
 * The exchange is owned entirely by the backend, which redirects back with the token
 * pair, and no Google library is loaded into this app (user decision, 2026-08-26).
 *
 * ## Its colours do not follow the theme
 *
 * Google's sign-in branding guidelines fix the surface and the mark, so this is the one
 * surface in the app that is the same in Night and in Day. Plan 0002 records that as a
 * component token rather than a primitive reached for from here, which is what keeps
 * rule T1 exactly true. The 0009 mock sketches it as an outlined button on the dark
 * frame; it is drawn with the design system's tokens instead, so that the app has one
 * Google button rather than two that differ by screen.
 *
 * ## It records rather than navigates
 *
 * Section 5.6: the callback answers JSON rather than redirecting into the app, and it
 * never passes `linkUserId`, so a guest who tapped it would be given a **fresh
 * registered user** and lose every group. Both are gateway changes. Until they land the
 * button reports its tap and goes nowhere, and it is not offered to a guest at all,
 * which the container decides.
 */
@Component({
  selector: 'lib-google-option',
  imports: [RokuTranslatorPipe, GoogleIcon],
  template: `
    <div aria-hidden="true" class="divider">
      <span class="rule"></span>
      <span class="or">{{ 'home.or' | rokuT }}</span>
      <span class="rule"></span>
    </div>

    <button (click)="continueWithGoogle.emit()" class="google" type="button">
      <lib-google-icon class="glyph" />
      {{ 'home.action.google' | rokuT }}
    </button>
  `,
  styleUrl: './google-option.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoogleOption {
  readonly continueWithGoogle = output<void>();
}
