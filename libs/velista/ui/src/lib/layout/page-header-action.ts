import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * One quick action in a `PageHeader` (velista `0130`, rule H5).
 *
 * An attribute on the page's own `button`, so the click handler, the accessible name
 * and a tour anchor stay where the page wrote them and this only supplies the look.
 * Sass cannot cross a library boundary, and a header action written once per feature
 * library is how six copies of one back button came to exist.
 *
 * ```html
 * <lib-page-header [title]="name()">
 *   <ng-container pageHeaderActions>
 *     <button (click)="openFilter()" [attr.aria-label]="…" libPageHeaderAction>
 *       <lib-filter-icon />
 *     </button>
 *   </ng-container>
 * </lib-page-header>
 * ```
 *
 * ## The badge is drawn here
 *
 * A count projected by the page would belong to the page's stylesheet, which cannot
 * reach in here. It is `aria-hidden`: the page puts the count in the button's name,
 * because a count that only exists as a dot over a glyph is one a screen reader never
 * hears.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[libPageHeaderAction]',
  template: `
    <ng-content />
    @if (badge(); as count) {
      <span aria-hidden="true" class="badge">{{ count }}</span>
    }
  `,
  styleUrl: './page-header-action.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-text]': 'kind() === "text"',
    '[class.is-on]': '(badge() ?? 0) > 0',
    '[class.is-accent]': 'accent()',
  },
})
export class PageHeaderAction {
  /**
   * `icon` is a square of one touch target around a glyph. `text` is a word at the
   * touch target's height, for Near me, Walks, Done and Stop.
   */
  readonly kind = input<'icon' | 'text'>('icon');

  /** A count over the glyph's corner. Zero and null draw nothing. */
  readonly badge = input<number | null>(null);

  /**
   * The quiet action colour on an icon action, for the one control in a header that
   * leads somewhere new: the assistant on home.
   */
  readonly accent = input(false);
}
