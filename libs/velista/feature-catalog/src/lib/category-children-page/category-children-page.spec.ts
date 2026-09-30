import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeCategoryStore,
  MEMORY_CATEGORIES,
  provideFakeCategoryStore,
} from '@portfolio/velista/data-access';
import {
  PageNavigation,
  provideVelistaTesting,
} from '@portfolio/velista/platform';
import { BehaviorSubject } from 'rxjs';
import { CategoryChildrenPage } from './category-children-page';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let tick = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

async function render(parentSlug: string, current: string | null = null) {
  TestBed.resetTestingModule();
  const pages = { back: jest.fn().mockResolvedValue(undefined) };
  const params = convertToParamMap({ parentSlug });
  const query = convertToParamMap(
    current === null ? {} : { category: current }
  );

  await TestBed.configureTestingModule({
    imports: [CategoryChildrenPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideRouter([]),
      provideFakeCategoryStore(fakeCategoryStore(MEMORY_CATEGORIES)),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: params, queryParamMap: query },
          paramMap: new BehaviorSubject(params),
          queryParamMap: new BehaviorSubject(query),
        },
      },
      { provide: PageNavigation, useValue: pages },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CategoryChildrenPage);
  fixture.detectChanges();
  await settle(fixture);
  return { fixture, pages };
}

function cards(fixture: ComponentFixture<CategoryChildrenPage>) {
  return [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll(
      'lib-category-rows'
    ),
  ].map((card) => [...card.querySelectorAll<HTMLAnchorElement>('a')]);
}

describe('CategoryChildrenPage (velista 0119)', () => {
  it('heads the page with the root, then Everything in it, then each child with a product', async () => {
    const { fixture } = await render('dairy-and-eggs');
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.head h1')?.textContent).toContain(
      'Dairy and eggs'
    );
    const [everything, children] = cards(fixture);

    expect(everything?.map((link) => link.textContent?.trim())).toEqual([
      expect.stringContaining('catalog.categories.everything'),
    ]);
    expect(everything?.[0]?.getAttribute('href')).toBe(
      '/velista/en/catalog?category=dairy-and-eggs'
    );
    // Plant based drinks holds nothing, so it is not drawn.
    expect(children?.map((link) => link.getAttribute('href'))).toEqual([
      '/velista/en/catalog?category=milk',
      '/velista/en/catalog?category=yogurts-and-desserts',
      '/velista/en/catalog?category=eggs',
    ]);
  });

  it('marks the leaf the tab is narrowed to, when the chip reopened it', async () => {
    const { fixture } = await render('dairy-and-eggs', 'milk');
    const [everything, children] = cards(fixture);
    const milk = children?.[0];

    expect(milk?.getAttribute('aria-current')).toBe('true');
    expect(milk?.getAttribute('aria-label')).toBe(
      'catalog.categories.rowChosen'
    );
    expect(milk?.querySelector('lib-check-icon')).not.toBeNull();
    expect(children?.[1]?.hasAttribute('aria-current')).toBe(false);
    expect(everything?.[0]?.hasAttribute('aria-current')).toBe(false);
  });

  it('goes back one step, with the catalog tab as the fallback', async () => {
    const { fixture, pages } = await render('pantry');
    const back = (fixture.nativeElement as HTMLElement).querySelector(
      'button.back'
    );

    expect(back?.getAttribute('aria-label')).toBe(
      'catalog.categories.backToRoots'
    );
    (back as HTMLButtonElement).click();
    expect(pages.back).toHaveBeenCalledWith('/velista/en/catalog');
  });

  it('sends a slug that is not a root to the page of parents, in place', async () => {
    const navigate = jest
      .spyOn(Router.prototype, 'navigateByUrl')
      .mockResolvedValue(true);

    await render('milk');

    expect(navigate).toHaveBeenCalledWith('/velista/en/catalog/categories', {
      replaceUrl: true,
    });
    navigate.mockRestore();
  });
});
