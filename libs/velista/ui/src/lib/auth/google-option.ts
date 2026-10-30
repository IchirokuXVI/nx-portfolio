import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { GoogleIcon } from '../icons/icons';
import { LinkedText } from '../legal/linked-text';

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
 * ## It starts the sign in, and the container says when to draw it
 *
 * A tap is an output. The container calls `GoogleSignIn.start()`, which sends the
 * document to the gateway, and shows the failure when the start is refused (velista
 * `0171`). A guest is offered it like anybody else: backend `0230` links the guest
 * account in place, so the groups it holds stay.
 *
 * It is never drawn in a deployment with no Google client (`features.googleSignIn`).
 * The container asks and leaves this out, divider and all. Inside the native shell it
 * is drawn, and the press asks Android's account picker (velista `0175`).
 *
 * ## The line under it is part of it
 *
 * "By continuing with Google you accept the Terms" (velista `0173`, target 4): the press
 * is the acceptance, so the line is drawn by this component and a fifth Google button
 * cannot be added without it. It is left out only when the deployment published no
 * terms, which the container says with a null {@link termsUrl}.
 */
@Component({
  selector: 'lib-google-option',
  imports: [RokuTranslatorPipe, GoogleIcon, LinkedText],
  template: `
    <div aria-hidden="true" class="divider">
      <span class="rule"></span>
      <span class="or">{{ 'home.or' | rokuT }}</span>
      <span class="rule"></span>
    </div>

    <button
      (click)="continueWithGoogle.emit()"
      [attr.aria-busy]="busy()"
      [attr.aria-describedby]="describedBy()"
      class="google"
      type="button"
    >
      <lib-google-icon class="glyph" />
      {{ 'home.action.google' | rokuT }}
    </button>

    @if (termsUrl(); as url) {
      <p class="terms-line">
        <lib-linked-text
          [href]="url"
          [keepQuery]="true"
          [text]="'legal.accept.google' | rokuT"
        />
      </p>
    }
  `,
  styleUrl: './google-option.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoogleOption {
  readonly continueWithGoogle = output<void>();

  /** True while a start is on its way, until the document leaves for the gateway. */
  readonly busy = input(false);

  /** The id of the message a refused start shows, or null when there is none. */
  readonly describedBy = input<string | null>(null);

  /**
   * Where the line under the button sends the terms, or null when the deployment
   * published none and there is nothing to accept.
   */
  readonly termsUrl = input<string | null>(null);
}
