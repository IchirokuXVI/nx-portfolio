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
 * **It is the only place that draws a product photo** (velista `0162`, section 3):
 * the card of the catalog and the search, a row of a list, a tile of the line page
 * and the header of a product page. Each host sets the size it wants through the
 * custom properties this reads (`--app-line-picture-size`,
 * `--app-line-picture-radius` and `--app-line-picture-glyph`), so the picture has
 * no size input.
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
        [attr.loading]="loading()"
        [src]="src"
        alt=""
        class="image"
        decoding="async"
      />
    </ng-template>
  `,
  styleUrl: './product-picture.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-hidden]': 'zoomable() ? null : "true"',
    '[class.has-photo]': 'image() !== null',
  },
})
export class ProductPicture {
  /** The photo, or null to draw the icon. */
  readonly imageUrl = input<string | null>(null);

  /**
   * The product's name, to open the photo large on a press, or null for a picture
   * that does nothing.
   */
  readonly zoom = input<string | null>(null);

  /**
   * `eager` for a picture above the fold, the header of a product page, so the
   * browser does not wait for layout to fetch it. Lazy everywhere else.
   */
  readonly loading = input<'lazy' | 'eager'>('lazy');

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
