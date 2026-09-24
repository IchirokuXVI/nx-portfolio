import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type ActivatedRoute } from '@angular/router';
import { ListSearchNavigation } from './list-search';
import { PageNavigation } from './page-navigation';

@Component({ template: '' })
class Blank {}

/**
 * The open list search is `?search=1` (velista `0109`), and these are the URLs the two
 * pages build for it, against a real router.
 */
describe('ListSearchNavigation', () => {
  let router: Router;
  let back: jest.Mock;
  let search: ListSearchNavigation;

  beforeEach(async () => {
    back = jest.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'lists/:listId',
            component: Blank,
            children: [{ path: 'sheet/filter', component: Blank }],
          },
        ]),
        { provide: PageNavigation, useValue: { back } },
      ],
    });
    router = TestBed.inject(Router);
    search = TestBed.inject(ListSearchNavigation);
  });

  /** The page's own route, which is the one a page injects. */
  function pageRoute(): ActivatedRoute {
    return router.routerState.root.firstChild as ActivatedRoute;
  }

  it('opens by adding search=1 to the page, merged with what the query had', async () => {
    await router.navigateByUrl('/lists/l1?line=ln-1');

    await search.open(pageRoute());

    expect(router.url).toBe('/lists/l1?line=ln-1&search=1');
  });

  it('closes through PageNavigation.back, with the page without search as the fallback', async () => {
    await router.navigateByUrl('/lists/l1?line=ln-1&search=1');

    await search.close(pageRoute());

    expect(back).toHaveBeenCalledWith('/lists/l1?line=ln-1');
  });

  it('builds the fallback from the page even with a sheet open over it', async () => {
    await router.navigateByUrl('/lists/l1/sheet/filter?search=1');

    await search.close(pageRoute());

    expect(back).toHaveBeenCalledWith('/lists/l1');
  });

  it('carries search=1 onto a sheet only while the search is open', async () => {
    await router.navigateByUrl('/lists/l1');
    expect(search.kept(pageRoute())).toEqual({});

    await router.navigateByUrl('/lists/l1?search=1');
    expect(search.kept(pageRoute())).toEqual({ search: '1' });
  });
});
