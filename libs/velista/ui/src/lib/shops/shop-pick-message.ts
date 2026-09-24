import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CloseIcon, LocateIcon } from '../icons/icons';

/**
 * "Buying at Mercadona, Calle Mayor 3 (120 m). Change", after "Near me" picked a
 * shop (velista `0103`).
 *
 * A wrong automatic choice has to be easy to see and easy to undo, so the message
 * names the shop, the distance it was chosen on, and a way to change it. It stays
 * until the person dismisses it or the shop changes; the container decides both,
 * and this draws the message and reports the two taps.
 *
 * The information role, because it reports what happened and asks nothing. A
 * status region, so a screen reader hears the choice once, when it appears.
 */
@Component({
  selector: 'lib-shop-pick-message',
  imports: [CloseIcon, LocateIcon, RokuTranslatorPipe],
  template: `<div class="notice" role="status">
    <lib-locate-icon class="glyph" />
    <p class="text">
      {{
        'basket.view.shop.near.picked'
          | rokuT: { shop: shop(), distance: distance() }
      }}
      <button
        (click)="changeShop.emit()"
        [attr.aria-label]="'basket.view.shop.near.changeLabel' | rokuT"
        class="change"
        type="button"
      >
        {{ 'basket.view.shop.near.change' | rokuT }}
      </button>
    </p>
    <button
      (click)="dismissed.emit()"
      [attr.aria-label]="'basket.view.shop.near.dismiss' | rokuT"
      class="dismiss"
      type="button"
    >
      <lib-close-icon class="dismiss-glyph" />
    </button>
  </div>`,
  styleUrl: './shop-pick-message.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShopPickMessage {
  /** The chain and the shop, already joined: "Mercadona, Calle Mayor 3". */
  readonly shop = input.required<string>();

  /** How far it was, already formatted: "120 m". */
  readonly distance = input.required<string>();

  /**
   * Change was pressed: open the picker again. Not `change`, which is a DOM event
   * a host listener would catch too.
   */
  readonly changeShop = output<void>();

  /** The x was pressed: the message goes, and the shop stays. */
  readonly dismissed = output<void>();
}
