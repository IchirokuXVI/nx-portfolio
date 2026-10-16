import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { ProductIcon } from '../icons/icons';

/**
 * The picture of the product a row of a list shows (velista `0145`, section 3): its
 * photo, or the product icon when it has none or the photo does not load.
 *
 * Decoration. The row says what the product is in words, so the picture has no
 * accessible name and is hidden from a screen reader.
 *
 * The catalog row and the cards of the line page draw the same picture with their
 * own markup. Moving them onto this is a later cleanup (section 10).
 */
@Component({
  selector: 'lib-product-picture',
  imports: [ProductIcon],
  template: `
    @if (image(); as src) {
      <img
        (error)="broken.set(src)"
        [src]="src"
        alt=""
        class="image"
        decoding="async"
        loading="lazy"
      />
    } @else {
      <lib-product-icon class="glyph" />
    }
  `,
  styleUrl: './product-picture.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
})
export class ProductPicture {
  /** The photo, or null to draw the icon. */
  readonly imageUrl = input<string | null>(null);

  /** A photo that failed to load, so the icon takes its place. */
  protected readonly broken = signal<string | null>(null);

  protected readonly image = computed(() => {
    const src = this.imageUrl();
    return src !== null && src !== this.broken() ? src : null;
  });
}
