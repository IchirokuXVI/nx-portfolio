import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { FullscreenIcon, PhoneIcon, SignalIcon } from '../icons/icons';

/**
 * The three lines about what changes once it is installed (plan 0033, section 4.1).
 *
 * **Each one is a claim about behaviour and each has to be true of the build that
 * ships**: full screen with no browser chrome, which is the manifest's `display`; one
 * tap from the home screen, which is what installing means; and the last opened list
 * still readable when the signal drops, which is the service worker `0013` turned on.
 * If any of the three stops being true, the line comes out rather than being softened.
 *
 * A component rather than three lines in the page's template because the install page
 * and the `installed` state draw the same three, and two copies of a claim is how one
 * of them ends up outliving the behaviour it describes.
 */
@Component({
  selector: 'lib-install-benefits',
  imports: [RokuTranslatorPipe, FullscreenIcon, PhoneIcon, SignalIcon],
  templateUrl: './install-benefits.html',
  styleUrl: './install-benefits.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallBenefits {
  /**
   * Drawn quietly, for the reader who already has all three.
   *
   * On the `installed` screen these are no longer an argument, they are a description
   * of what is already happening, so they step back and let the confirmation lead. The
   * words are identical either way: this is emphasis, never meaning.
   */
  readonly quiet = input(false);
}
