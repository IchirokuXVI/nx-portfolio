import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { CategoryStore } from '@portfolio/velista/data-access';
import { APP_BASE_PATH, categoryName } from '@portfolio/velista/models';
import { appPath, PageNavigation } from '@portfolio/velista/platform';
import { PageHeader } from '@portfolio/velista/ui';
import { formatCount, visibleBranches } from '../category-choice';
import {
  CategoryRows,
  categoryRowView,
  type CategoryRowView,
} from '../category-rows/category-rows';
import { catalogChoiceOf, catalogQueryOf } from '../supermarket-choice';

/** The bones drawn while the tree is on its way: about a phone's worth. */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * The page of parents (velista `0119`, target 1): every root with a product under it,
 * each a link to its children.
 *
 * ## A page and not a sheet
 *
 * The picker is two decisions deep and the second has its own back, which is the
 * sheet over a sheet the sheet rule exists to avoid. As a page it keeps the bar, so
 * somebody browsing categories is still visibly in the catalog tab (section 1).
 *
 * ## It holds no choice
 *
 * The chosen category lives in the tab's URL and nowhere else (target 5), so this page
 * only lists places to go. The tree is `CategoryStore`'s, read once per session.
 *
 * What the tab was narrowed by when it opened this page (the supermarket, the text,
 * the order) arrives in the query and is handed on to every row, so choosing a
 * category changes the category and nothing else.
 */
@Component({
  selector: 'lib-categories-page',
  imports: [CategoryRows, PageHeader, RokuTranslatorPipe],
  templateUrl: './categories-page.html',
  styleUrl: './categories-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesPage {
  private readonly _store = inject(CategoryStore);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);

  /** The tab's choice as this page was handed it, passed on and never changed. */
  private readonly _query = catalogQueryOf(
    catalogChoiceOf(inject(ActivatedRoute).snapshot.queryParamMap)
  );

  protected readonly skeletonRows = SKELETON_ROWS;

  protected readonly state = this._store.state;

  protected readonly rows = computed<readonly CategoryRowView[]>(() => {
    const locale = this._locale();
    // Read so the rows are drawn again once the words arrive.
    this._translator.loaded();
    const translate = (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);

    return visibleBranches(this._store.roots()).map(({ root }) =>
      categoryRowView(
        {
          key: root.slug,
          name: categoryName(root, locale),
          itemCount: root.itemCount,
          link: appPath(
            locale,
            this._basePath,
            'catalog',
            'categories',
            root.slug
          ),
          queryParams: this._query,
          current: false,
        },
        formatCount(root.itemCount, locale),
        translate
      )
    );
  });

  constructor() {
    void this._store.ensure();
  }

  protected retry(): void {
    void this._store.ensure();
  }

  /**
   * The chevron: one step back, or the tab on a cold load (target 4), narrowed as
   * it was.
   */
  protected async back(): Promise<void> {
    const url = this._router.parseUrl(
      appPath(this._locale(), this._basePath, 'catalog')
    );
    url.queryParams = this._query;
    await this._pages.back(this._router.serializeUrl(url));
  }
}
