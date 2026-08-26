import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { APP_BRAND } from '@portfolio/velista/models';
import { BrandMark } from './brand-mark';

/**
 * The lockup: the sailboat and the product name, set in the display face.
 *
 * The name is read from `APP_BRAND` and never written down here. That is the
 * whole of criterion 4 in plan 0002, section 12, and `brand-rename.spec.ts`
 * rehearses it by rendering this component under a different brand and checking
 * that nothing of the old one survives.
 *
 * One accessible name for the lockup, on this host, rather than one on the mark
 * and another on the text. The mark stays decorative by default for that reason.
 */
@Component({
  selector: 'lib-brand-wordmark',
  imports: [BrandMark],
  template: `<lib-brand-mark class="wordmark__mark" />
    <span class="wordmark__name">{{ name() }}</span>`,
  styleUrl: './brand-wordmark.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'name()',
  },
})
export class BrandWordmark {
  /**
   * Use the short form. Both come from `AppBrand`; which one fits is the caller's
   * call, because it depends on the space, not on the brand.
   */
  readonly short = input(false);

  private readonly _brand = inject(APP_BRAND);

  readonly name = computed(() =>
    this.short() ? this._brand.shortName : this._brand.name
  );
}
