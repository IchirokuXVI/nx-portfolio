import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
} from '@angular/core';
import { StoreIcon } from '../icons/icons';

/** The five sizes a logo is drawn at, each a token (`--app-chain-logo-*`). */
export type ChainLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * What a logo draws, decided by whoever names the chain.
 *
 * `store` is for the two things that are not one brand: OTHER among the chain
 * buttons, and "All supermarkets" in the catalog. Both draw the store glyph.
 */
export interface ChainLogoView {
  readonly logoUrl: string | null;
  /** The chain's name in the reader's language, whose first letter is the fallback. */
  readonly name: string;
  readonly store: boolean;
}

/**
 * A chain's logo (velista `0124`): the image the wire names, else the chain's
 * initial in the app's own colours, else the store glyph.
 *
 * **The initial is the typeahead's chain mark, bigger**, and it is drawn in the
 * app's colours rather than the brand's: the wire carries no chain colour, and a
 * palette kept here would be a second catalog of chains nobody curates. Every logo
 * is null today (backend `0170`, section 3), so the initial is what people see
 * until an operator sets one.
 *
 * An image that fails to load falls back to the initial, so a dead link draws a
 * letter rather than a broken picture.
 *
 * Hidden from assistive technology: it always sits beside the chain's name, and a
 * letter read out before the name it abbreviates says the name twice.
 */
@Component({
  selector: 'lib-chain-logo',
  imports: [StoreIcon],
  template: `
    @if (logo().store) {
      <lib-store-icon class="glyph" />
    } @else if (image(); as src) {
      <img (error)="broken.set(true)" [src]="src" alt="" class="image" />
    } @else {
      {{ initial() }}
    }
  `,
  styleUrl: './chain-logo.scss',
  host: {
    'aria-hidden': 'true',
    '[class.is-xs]': "size() === 'xs'",
    '[class.is-sm]': "size() === 'sm'",
    '[class.is-md]': "size() === 'md'",
    '[class.is-lg]': "size() === 'lg'",
    '[class.is-xl]': "size() === 'xl'",
    '[class.is-image]': 'image() !== null && !logo().store',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainLogo {
  readonly logo = input.required<ChainLogoView>();

  readonly size = input<ChainLogoSize>('md');

  /**
   * The image failed to load, which draws the initial until the address changes:
   * a new address gets its own chance.
   */
  protected readonly broken = linkedSignal({
    source: () => this.logo().logoUrl,
    computation: () => false,
  });

  protected readonly image = computed(() => {
    const url = this.logo().logoUrl;
    return typeof url !== 'string' || url.trim() === '' || this.broken()
      ? null
      : url;
  });

  protected readonly initial = computed(
    () => Array.from(this.logo().name.trim())[0]?.toLocaleUpperCase() ?? ''
  );
}
