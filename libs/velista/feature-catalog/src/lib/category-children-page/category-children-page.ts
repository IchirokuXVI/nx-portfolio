import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
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
import {
  catalogChoiceOf,
  catalogQueryOf,
  type CatalogChoice,
} from '../supermarket-choice';

/** The route parameter naming the root, by slug. */
export const PARENT_SLUG_PARAM = 'parentSlug';

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

/**
 * The page of one root's children (velista `0119`, target 1).
 *
 * Headed by the root's name, with a first card of one row, "Everything in Frozen",
 * that picks the root itself, then one row per child with a product under it. A tap
 * on either goes to the catalog tab with `?category=<slug>`, which is a push, so the
 * phone's back walks tab, parents, children in reverse (target 4).
 *
 * "Everything in Frozen" rather than the plan's "All frozen": the name is data and is
 * used as it arrives, never lowercased, which keeps proper nouns and Spanish agreement
 * right ("Todo en Congelados"). The user approved it on the mock.
 *
 * ## Reopened from the chip
 *
 * The chip's body links here with the tab's own `?category=`, so the page marks the
 * category the tab is narrowed to with a tick, the quiet amber and `aria-current`.
 * The choice still lives only in the URL: this page reads it and never holds it.
 *
 * ## A row changes the category and nothing else
 *
 * The rest of what the tab was narrowed by (the supermarket, the text, the order)
 * arrives in the same query, and every row hands it back beside its own slug.
 *
 * ## A slug the tree does not hold
 *
 * Once the tree has landed, a slug that is not a root with something under it is a
 * page with nothing to draw, so it goes to the page of parents in place of this entry.
 */
@Component({
  selector: 'lib-category-children-page',
  imports: [CategoryRows, PageHeader, RokuTranslatorPipe],
  templateUrl: './category-children-page.html',
  styleUrl: './category-children-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryChildrenPage {
  private readonly _store = inject(CategoryStore);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  protected readonly skeletonRows = SKELETON_ROWS;

  protected readonly state = this._store.state;

  /** The root this page lists, by slug, from the URL. */
  private readonly _parentSlug = signal<string | null>(
    this._route.snapshot.paramMap.get(PARENT_SLUG_PARAM)
  );

  /**
   * The tab's choice as this page was handed it. Its category is the one the tab is
   * narrowed to, when the chip opened this page.
   */
  private readonly _choice = signal<CatalogChoice>(
    catalogChoiceOf(this._route.snapshot.queryParamMap)
  );

  /** The branch this page draws, hidden rows already dropped. */
  protected readonly branch = computed(() => {
    const slug = this._parentSlug();
    return (
      visibleBranches(this._store.roots()).find(
        (one) => one.root.slug === slug
      ) ?? null
    );
  });

  /**
   * The root's name, or null until the tree holds it. The header never loads (velista
   * `0130`, rule H6), so the template draws the word for the kind of page meanwhile.
   */
  protected readonly title = computed(() => {
    const branch = this.branch();
    return branch === null ? null : categoryName(branch.root, this._locale());
  });

  /** The first card: the root itself. */
  protected readonly everything = computed<readonly CategoryRowView[]>(() => {
    const branch = this.branch();
    if (branch === null) {
      return [];
    }
    const locale = this._locale();
    this._translator.loaded();
    const root = branch.root;
    const choice = this._choice();
    return [
      categoryRowView(
        {
          key: `${root.slug}:everything`,
          name: this._translator.t(
            'catalog.categories.everything',
            undefined,
            locale,
            { name: categoryName(root, locale) }
          ),
          itemCount: root.itemCount,
          link: this._tabPath(locale),
          queryParams: catalogQueryOf({ ...choice, category: root.slug }),
          current: choice.category === root.slug,
        },
        formatCount(root.itemCount, locale),
        this._translate(locale)
      ),
    ];
  });

  protected readonly children = computed<readonly CategoryRowView[]>(() => {
    const branch = this.branch();
    if (branch === null) {
      return [];
    }
    const locale = this._locale();
    this._translator.loaded();
    const choice = this._choice();
    return branch.children.map((child) =>
      categoryRowView(
        {
          key: child.slug,
          name: categoryName(child, locale),
          itemCount: child.itemCount,
          link: this._tabPath(locale),
          queryParams: catalogQueryOf({ ...choice, category: child.slug }),
          current: choice.category === child.slug,
        },
        formatCount(child.itemCount, locale),
        this._translate(locale)
      )
    );
  });

  /** A slug with nothing to draw, once the tree has landed, leaves for the parents. */
  private readonly _missingEffect = effect(() => {
    if (this._store.state() !== 'loaded' || this.branch() !== null) {
      return;
    }
    untracked(() => {
      void this._router.navigateByUrl(
        this._url(
          appPath(this._locale(), this._basePath, 'catalog', 'categories')
        ),
        { replaceUrl: true }
      );
    });
  });

  constructor() {
    const params = this._route.paramMap.subscribe((map) =>
      this._parentSlug.set(map.get(PARENT_SLUG_PARAM))
    );
    const query = this._route.queryParamMap.subscribe((map) =>
      this._choice.set(catalogChoiceOf(map))
    );
    inject(DestroyRef).onDestroy(() => {
      params.unsubscribe();
      query.unsubscribe();
    });

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
    await this._pages.back(this._url(this._tabPath(this._locale())));
  }

  /** This path with the tab's choice, unchanged, in its query. */
  private _url(path: string): string {
    const url = this._router.parseUrl(path);
    url.queryParams = catalogQueryOf(this._choice());
    return this._router.serializeUrl(url);
  }

  private _tabPath(locale: string): string {
    return appPath(locale, this._basePath, 'catalog');
  }

  private _translate(locale: string) {
    return (key: string, args?: Record<string, unknown>) =>
      this._translator.t(key, undefined, locale, args);
  }
}
