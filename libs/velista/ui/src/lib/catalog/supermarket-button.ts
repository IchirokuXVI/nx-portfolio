import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ChevronRightIcon, CloseIcon } from '../icons/icons';
import { ChainLogo, type ChainLogoView } from '../shops/chain-logo';

/**
 * The catalog's one Supermarket button (velista `0124`, target 8), where the chain
 * chips used to be.
 *
 * The logo, the word SUPERMARKET, and the choice: All supermarkets at rest,
 * "Mercadona · any shop" with a chain, "Mercadona · Calle Mayor 3" with a shop. The
 * body opens the picker page. Once something is chosen the chevron becomes an x,
 * a second button of its own, which goes back to every supermarket: two controls
 * side by side and never one inside the other.
 *
 * It holds nothing and decides nothing (rule D1): the page says what is chosen
 * and where a press goes.
 */
@Component({
  selector: 'lib-supermarket-button',
  imports: [ChainLogo, ChevronRightIcon, CloseIcon, RokuTranslatorPipe],
  template: `
    <div [class.is-set]="chosen()" class="frame">
      <button (click)="opened.emit()" class="body" type="button">
        <lib-chain-logo [logo]="logo()" size="sm" />
        <span class="text">
          <span class="key">{{ 'catalog.supermarket.label' | rokuT }}</span>
          <span class="value">
            {{ value() }}
            @if (detail(); as more) {
              <span class="detail">· {{ more }}</span>
            }
          </span>
        </span>
        @if (!chosen()) {
          <lib-chevron-right-icon class="chevron" />
        }
      </button>
      @if (chosen()) {
        <button
          (click)="cleared.emit()"
          [attr.aria-label]="'catalog.supermarket.clear' | rokuT"
          class="clear"
          type="button"
        >
          <lib-close-icon class="clear-glyph" />
        </button>
      }
    </div>
  `,
  styleUrl: './supermarket-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupermarketButton {
  /** The chosen chain's logo, or the store glyph for every supermarket. */
  readonly logo = input.required<ChainLogoView>();

  /** All supermarkets, or the chosen chain's name. */
  readonly value = input.required<string>();

  /** After the chain: "any shop", or the shop's own name or street. Null for none. */
  readonly detail = input<string | null>(null);

  /** Whether a chain or a shop is chosen, which trades the chevron for the x. */
  readonly chosen = input(false);

  /** The body was pressed: open the picker. */
  readonly opened = output<void>();

  /** The x was pressed: every supermarket again. */
  readonly cleared = output<void>();
}
