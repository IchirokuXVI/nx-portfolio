import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ProductIcon } from '../icons/icons';
import { PhotoViewer } from '../photo/photo-viewer';

/**
 * The picture of the product a row of a list shows (velista `0145`, section 3): its
 * photo, or the product icon when it has none or the photo does not load.
 *
 * Decoration, unless it is given the product's name in {@link zoom}. The row says
 * what the product is in words, so a picture that does nothing has no accessible
 * name and is hidden from a screen reader.
 *
 * With a name and a photo, the picture is a button of its own that opens the photo
 * large in the {@link PhotoViewer}. The press stops at the button, so the row under
 * it does not also open its sheet. The icon stays decoration: there is nothing
 * bigger to show.
 *
 * The cards of the line page draw the same picture with their own markup. Moving
 * them onto this is a later cleanup (section 10).
 */
@Component({
  selector: 'lib-product-picture',
  imports: [NgTemplateOutlet, PhotoViewer, ProductIcon, RokuTranslatorPipe],
  template: `
    @if (image(); as src) {
      @if (zoom(); as name) {
        <button
          (click)="$event.stopPropagation(); viewing.set(true)"
          (keydown)="$event.stopPropagation()"
          (pointerdown)="$event.stopPropagation()"
          [attr.aria-label]="'photo.open' | rokuT: { name }"
          class="zoom"
          type="button"
        >
          <ng-container
            [ngTemplateOutlet]="photo"
            [ngTemplateOutletContext]="{ $implicit: src }"
          />
        </button>
        @if (viewing()) {
          <lib-photo-viewer
            (closed)="viewing.set(false)"
            [name]="name"
            [src]="src"
          />
        }
      } @else {
        <ng-container
          [ngTemplateOutlet]="photo"
          [ngTemplateOutletContext]="{ $implicit: src }"
        />
      }
    } @else {
      <lib-product-icon class="glyph" />
    }

    <ng-template #photo let-src>
      <img
        (error)="broken.set(src)"
        [src]="src"
        alt=""
        class="image"
        decoding="async"
        loading="lazy"
      />
    </ng-template>
  `,
  styleUrl: './product-picture.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-hidden]': 'zoomable() ? null : "true"' },
})
export class ProductPicture {
  /** The photo, or null to draw the icon. */
  readonly imageUrl = input<string | null>(null);

  /**
   * The product's name, to open the photo large on a press, or null for a picture
   * that does nothing.
   */
  readonly zoom = input<string | null>(null);

  /** A photo that failed to load, so the icon takes its place. */
  protected readonly broken = signal<string | null>(null);

  /** Whether the photo is drawn large. */
  protected readonly viewing = signal(false);

  protected readonly image = computed(() => {
    const src = this.imageUrl();
    return src !== null && src !== this.broken() ? src : null;
  });

  protected readonly zoomable = computed(
    () => this.image() !== null && this.zoom() !== null
  );
}
