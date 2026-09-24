import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { CloseIcon } from '../icons/icons';

/** One chip, its name already in the reader's language. */
export interface ChainChip {
  readonly supermarketId: string;
  readonly name: string;
}

/**
 * The chain row on the catalog tab (velista `0100`, section 2).
 *
 * `All shops`, then one chip per chain near the person, in the order the server
 * returned them. **One chain at a time**: pressing another moves the choice, and
 * pressing the chosen one, or its cross, puts it back to all shops.
 *
 * A group of toggle buttons with `aria-pressed`, not links and not radios
 * (section 7): each chip is a switch on the list below, and the cross is part of
 * the chosen chip rather than a second control beside it.
 *
 * The row scrolls sideways rather than folding. Five chains do not fit in 390
 * pixels, and a chip that folded under the others is a chip nobody finds.
 */
@Component({
  selector: 'lib-chain-chips',
  imports: [CloseIcon, RokuTranslatorPipe],
  template: `
    <div
      [attr.aria-label]="'catalog.chips.label' | rokuT"
      class="chips"
      role="group"
    >
      <button
        (click)="chosen.emit(null)"
        [attr.aria-pressed]="selected() === null"
        [class.is-on]="selected() === null"
        class="chip"
        type="button"
      >
        {{ 'catalog.chips.all' | rokuT }}
      </button>

      @for (chain of chains(); track chain.supermarketId) {
        <button
          (click)="
            chosen.emit(
              selected() === chain.supermarketId ? null : chain.supermarketId
            )
          "
          [attr.aria-pressed]="selected() === chain.supermarketId"
          [class.is-on]="selected() === chain.supermarketId"
          class="chip"
          type="button"
        >
          {{ chain.name }}
          @if (selected() === chain.supermarketId) {
            <lib-close-icon aria-hidden="true" class="clear" />
          }
        </button>
      }
    </div>
  `,
  styleUrl: './chain-chips.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainChips {
  readonly chains = input.required<readonly ChainChip[]>();

  /** The chosen chain's id, or null for all shops. */
  readonly selected = input<string | null>(null);

  /** A chain's id, or null for all shops. */
  readonly chosen = output<string | null>();
}
