import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { PinIcon } from '../icons/icons';

/**
 * "Outside your areas", under a shop whose postal code is not one of the basket
 * owner's (velista `0102`; backend `0163`, section 3).
 *
 * One component because the note is drawn **wherever the shop is named**: the
 * filter sheet's "Buying at" row, the get a list sheet's, and a row of the shop
 * list. Three copies of one line of copy and one colour would drift.
 *
 * The attention role, violet, as the user confirmed on the mock: it is a fact the
 * person may want to act on and not a fault, and `0002` gives the app no warning
 * colour on purpose. Words beside a pin, so the colour is never the only carrier.
 * It changes nothing about the prices, which are that shop's.
 */
@Component({
  selector: 'lib-outside-areas',
  imports: [PinIcon, RokuTranslatorPipe],
  template: `<lib-pin-icon class="glyph" />{{
      'basket.view.shop.outside' | rokuT
    }}`,
  styleUrl: './outside-areas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutsideAreas {}
