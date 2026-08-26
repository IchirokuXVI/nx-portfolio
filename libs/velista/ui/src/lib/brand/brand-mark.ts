import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { APP_BRAND } from '@portfolio/velista/models';

/**
 * The sailboat, drawn in `currentColor`.
 *
 * The outline version, not the amber tile: the tile knocks its scribbles out in
 * the background colour, so it only works on its own fill. Anywhere the mark has
 * to adopt the surrounding colour, such as a header, a footer or an empty state,
 * this is the one to use.
 *
 * The static `?raw` import is the repo's icon convention, and it is allowed here
 * by the same clause that allows the filenames at all: plan 0002 section 5.2 makes
 * the two brand **asset files** the one exception to rule N1, since the mark is
 * the identity itself. Everything else about the brand still arrives as data,
 * including the accessible name, which comes from `AppBrand` rather than from a
 * `<title>` baked into the file, so a rename does not have to edit the artwork.
 *
 * Inlining is also the only route that builds here. Emitting a brand SVG as a URL
 * instead, which is what `AppBrand.wordmarkSrc` being a filename invites, makes
 * webpack fail the production build with "Can't handle conflicting asset info for
 * sourceFilename" while scope hoisting this library. See plan 0002, section 5.3.
 */
@Component({
  selector: 'lib-brand-mark',
  template: `<span
    [attr.aria-hidden]="decorative() ? 'true' : null"
    [attr.aria-label]="decorative() ? null : label"
    [attr.role]="decorative() ? null : 'img'"
    [innerHTML]="mark()"
    class="mark"
  ></span>`,
  styleUrl: './brand-mark.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandMark {
  /**
   * Whether the mark is being drawn next to something that already names the
   * product, such as the wordmark. Two accessible names for one lockup is worse
   * than none, so the default is decorative and a caller opts into the label.
   */
  readonly decorative = input(true);

  readonly mark = signal<SafeHtml | null>(null);

  private readonly _brand = inject(APP_BRAND);
  private readonly _sanitizer = inject(DomSanitizer);

  /** The product name, from the one place it is allowed to live. */
  readonly label = this._brand.name;

  constructor() {
    // @ts-expect-error the `?raw` suffix does not match the ambient `*.svg` decl
    import('../../../assets/brand/velista-mark.svg?raw').then((module) => {
      this.mark.set(this._sanitizer.bypassSecurityTrustHtml(module.default));
    });
  }
}
