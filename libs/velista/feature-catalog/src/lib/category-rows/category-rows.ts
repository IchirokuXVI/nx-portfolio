import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CheckIcon, ChevronRightIcon } from '@portfolio/velista/ui';

/** One row of a picker page, every word already in the reader's language. */
export interface CategoryRowView {
  /** Stable across redraws: the slug, or the root's slug for its Everything row. */
  readonly key: string;
  readonly name: string;
  /** The count as words, `412 products` (rule P2). */
  readonly count: string;
  /** `name, count`, and `, chosen` after it on the current row. */
  readonly label: string;
  /** Where the row goes, an absolute app path. */
  readonly link: string;
  readonly queryParams: Record<string, string> | null;
  /** The category the tab is narrowed to, when the page was reopened from the chip. */
  readonly current: boolean;
}

/** Look up a key in the reader's language, as `RokuTranslatorService.t` does. */
export type CategoryTranslate = (
  key: string,
  args?: Record<string, unknown>
) => string;

/**
 * One row's words: the count in words and the accessible name built from it.
 *
 * Both pages build their rows here, so `name, count` and its `chosen` ending cannot be
 * worded two ways.
 */
export function categoryRowView(
  row: {
    readonly key: string;
    readonly name: string;
    readonly itemCount: number;
    readonly link: string;
    readonly queryParams: Record<string, string> | null;
    readonly current: boolean;
  },
  shown: string,
  translate: CategoryTranslate
): CategoryRowView {
  const count = translate('catalog.categories.count', {
    count: row.itemCount,
    shown,
  });
  return {
    key: row.key,
    name: row.name,
    count,
    label: translate(
      row.current ? 'catalog.categories.rowChosen' : 'catalog.categories.row',
      { name: row.name, amount: count }
    ),
    link: row.link,
    queryParams: row.queryParams,
    current: row.current,
  };
}

/**
 * One card of picker rows (velista `0119`, rules P1 and P2).
 *
 * Each row is **one link**: a name, a count in words and a chevron, 52 pixels tall,
 * named `name, count`, with the chevron hidden. The rows share one raised card with
 * hairlines between them, so the page reads as a list of places and not as more
 * product rows.
 *
 * Local to this library and not in `velista/ui`, because the two picker pages are
 * the only screens that draw it and both are here.
 */
@Component({
  selector: 'lib-category-rows',
  imports: [CheckIcon, ChevronRightIcon, RouterLink],
  template: `
    <ul class="group">
      @for (row of rows(); track row.key) {
        <li>
          <a
            [attr.aria-current]="row.current ? 'true' : null"
            [attr.aria-label]="row.label"
            [class.is-current]="row.current"
            [class.is-emphasis]="emphasis()"
            [queryParams]="row.queryParams"
            [routerLink]="row.link"
            class="row"
          >
            @if (row.current) {
              <lib-check-icon class="tick" />
            }
            <span class="name">{{ row.name }}</span>
            <span class="count">{{ row.count }}</span>
            <lib-chevron-right-icon class="chevron" />
          </a>
        </li>
      }
    </ul>
  `,
  styleUrl: './category-rows.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryRows {
  readonly rows = input.required<readonly CategoryRowView[]>();

  /** The semibold names of the children page's first card, "Everything in". */
  readonly emphasis = input(false);
}
