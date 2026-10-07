import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { BasketTotal } from '@portfolio/velista/models';
import { basketTotalAmounts, boughtShare } from './basket-total-amounts';

/**
 * How much of the estimated total is bought, as a track and its two ends
 * (velista `0132`, section 4).
 *
 * ## One name, said once
 *
 * The track is an image with a sentence for a name. The two captions under it
 * say the same two amounts to the eye, so they are `aria-hidden`: read aloud
 * they would be the name a second time.
 *
 * ## No gutter of its own
 *
 * The host is a plain block as wide as it is given. The page that projects it
 * under the tools row sets the gutter, as it does for the chips above it.
 *
 * Plain values in and nothing out: the page reads the sum and hands it down.
 */
@Component({
  selector: 'lib-basket-total-bar',
  imports: [RokuTranslatorPipe],
  template: `
    <div
      [attr.aria-label]="
        'basket.total.barLabel'
          | rokuT: { bought: amounts().bought, total: amounts().total }
      "
      class="track"
      role="img"
    >
      <span [style.inline-size.%]="share()" class="fill"></span>
    </div>
    <!-- The captions carry the tilde, through the same string as the number. -->
    @let bought = 'basket.total.amount' | rokuT: { amount: amounts().bought };
    @let left = 'basket.total.amount' | rokuT: { amount: amounts().left };
    <p aria-hidden="true" class="ends">
      <span class="end bought">
        {{ 'basket.total.boughtEnd' | rokuT: { amount: bought } }}
      </span>
      <span class="end left">
        {{ 'basket.total.leftEnd' | rokuT: { amount: left } }}
      </span>
    </p>
  `,
  styleUrl: './basket-total-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketTotalBar {
  /** The sum of the visible lines. The caller draws nothing with no priced line. */
  readonly total = input.required<BasketTotal>();

  /** The reader's language tag, for the money. */
  readonly locale = input.required<string>();

  protected readonly amounts = computed(() =>
    basketTotalAmounts(this.total(), this.locale())
  );

  protected readonly share = computed(() => boughtShare(this.total()));
}
