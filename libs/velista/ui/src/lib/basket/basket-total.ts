import { CdkOverlayOrigin } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { BasketTotal } from '@portfolio/velista/models';
import {
  AnchoredPopover,
  type AnchoredPopoverClose,
} from '../list/anchored-popover';
import { basketTotalAmounts } from './basket-total-amounts';

/**
 * What the visible lines of the basket come to, and the one way into what is
 * behind that number (velista `0132`, sections 3 and 5).
 *
 * ## A number that is a button
 *
 * Rule T7: the number is the only way into the popover, so it is a real button
 * and it carries no glyph that would promise more than it opens. Rule T5: it
 * always starts with a tilde, which is in the translation so a language can move
 * it. The accessible name says "about" in words, because a tilde read aloud is a
 * character and not a meaning.
 *
 * ## No live region
 *
 * The number moves with every quantity a thumb drags. The page's one polite
 * region already says what a move came to, and a second voice here would talk
 * over it.
 *
 * ## Plain values in
 *
 * Rule D1: only a page injects a store. The page reads the sum and hands it
 * down with the locale and the chain of the chosen shop. Whether it is open is
 * this component's own, because nothing outside it has to know: the popover
 * holds no control and opens no route.
 *
 * Named `BasketTotalNumber` and not after its selector, because `BasketTotal` is
 * the model's name for the sum and a page imports both.
 */
@Component({
  selector: 'lib-basket-total',
  imports: [AnchoredPopover, CdkOverlayOrigin, RokuTranslatorPipe],
  templateUrl: './basket-total.html',
  styleUrl: './basket-total.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasketTotalNumber {
  /** The sum of the visible lines. The caller draws nothing with no priced line. */
  readonly total = input.required<BasketTotal>();

  /** The reader's language tag, for the money. */
  readonly locale = input.required<string>();

  /**
   * The chain of the chosen shop, or null with no shop chosen. It only picks
   * which sentence counts the priced lines.
   */
  readonly chainName = input<string | null>(null);

  protected readonly open = signal(false);

  protected readonly amounts = computed(() =>
    basketTotalAmounts(this.total(), this.locale())
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  /** Closed by Escape, a press outside it or the overlay going; Escape hands focus back. */
  protected close(reason: AnchoredPopoverClose, control: HTMLElement): void {
    this.open.set(false);
    if (reason === 'escape') {
      control.focus();
    }
  }
}
