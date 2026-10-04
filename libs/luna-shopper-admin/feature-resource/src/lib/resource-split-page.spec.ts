import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { PAGE_HEADING_LEVEL, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { provideSections } from './admin-section';
import { ResourceListPage } from './resource-list-page';
import { ResourceSplitPage } from './resource-split-page';
import { resourceSplitRoute } from './routes';

/**
 * A list and the row that is open, side by side (admin plan 0042).
 *
 * jsdom matches no media query and the test build drops component styles, so
 * which pane shows is asserted on the class the styles hang from, and the
 * width of the screen is a `Viewport` the spec provides. That the class really
 * hides a pane is for the browser walk to show.
 */

/** How many times the list was read, so a list built twice is observable. */
let listReads = 0;

const gateway: ResourceGateway<ResourceRow> = {
  list: async () => {
    listReads += 1;
    return {
      items: [
        { id: 's1', name: 'Calle Feria 12' },
        { id: 's2', name: 'Avenida de la Paz 3' },
      ],
      nextCursor: null,
    };
  },
  read: () => Promise.reject(new Error('not used')),
  create: () => Promise.reject(new Error('not used')),
  update: () => Promise.reject(new Error('not used')),
  remove: () => Promise.reject(new Error('not used')),
};

const SHOPS = defineResource<{ id: string; name: string }>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'shops.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { edit: true },
  gateway: () => gateway,
});

/** What is open beside the list. It says which heading level it was given. */
@Component({ template: `<p data-shop-page>{{ level() }}</p>` })
class ShopPage {
  readonly level = inject(PAGE_HEADING_LEVEL);
}

interface Options {
  readonly split: boolean;
  readonly underHeader?: boolean;
  readonly emptyKey?: string;
}

async function mount(url: string, options: Options) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      {
        provide: Viewport,
        useValue: { compact: signal(false), split: signal(options.split) },
      },
      provideSections({ key: 'shops', label: '', held: [SHOPS] }),
      provideRouter([
        resourceSplitRoute(SHOPS, {
          listWidth: '340px',
          children: [{ path: ':shopId', component: ShopPage }],
          ...(options.underHeader === undefined
            ? {}
            : { underHeader: options.underHeader }),
          ...(options.emptyKey === undefined
            ? {}
            : { emptyKey: options.emptyKey }),
        }),
      ]),
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create(url);
  await drawn(harness);

  const element = harness.routeNativeElement as HTMLElement;
  return {
    harness,
    element,
    split: element.querySelector('.split') as HTMLElement,
    page: harness.routeDebugElement?.componentInstance as ResourceSplitPage,
    list: () =>
      harness.routeDebugElement?.query(By.directive(ResourceListPage))
        .componentInstance as ResourceListPage,
  };
}

/** Lets a read settle, then redraws. */
async function drawn(harness: RouterTestingHarness): Promise<void> {
  harness.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  harness.detectChanges();
}

describe('ResourceSplitPage', () => {
  let scrollTo: jest.SpyInstance;

  beforeEach(() => {
    listReads = 0;
    // jsdom has no layout, so `scrollTo` is a stub that logs. A spy keeps the
    // output clean and makes the scroll the page asks for observable.
    scrollTo = jest
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
  });

  afterEach(() => scrollTo.mockRestore());

  it('draws the list as a column and the open row beside it', async () => {
    const { element, split, list } = await mount('/shops/s2', { split: true });

    expect(list().embed).toBe('column');
    expect(element.querySelectorAll('.list [data-row]')).toHaveLength(2);
    expect(element.querySelector('.detail [data-shop-page]')).not.toBeNull();
    expect(split.style.getPropertyValue('--split-list')).toBe('340px');
  });

  /**
   * Below 72 rem one pane shows at a time, and which one is the `open` class:
   * the list until a row is opened, and then the row.
   */
  it('says which pane shows through the open class', async () => {
    const closed = await mount('/shops', { split: false });
    expect(closed.page.open()).toBe(false);
    expect(closed.split.classList.contains('open')).toBe(false);

    const open = await mount('/shops/s1', { split: false });
    expect(open.page.open()).toBe(true);
    expect(open.split.classList.contains('open')).toBe(true);
  });

  /**
   * Hidden and not removed, so that going back finds the filter, the loaded
   * pages and the place the operator left.
   */
  it('keeps the one list while a row opens and closes', async () => {
    const { harness, page, split, list } = await mount('/shops', {
      split: false,
    });
    const router = TestBed.inject(Router);
    const before = list();

    await router.navigateByUrl('/shops/s1');
    await drawn(harness);
    expect(page.open()).toBe(true);
    expect(split.classList.contains('open')).toBe(true);

    await router.navigateByUrl('/shops');
    await drawn(harness);
    expect(page.open()).toBe(false);
    expect(split.classList.contains('open')).toBe(false);

    expect(list()).toBe(before);
    expect(listReads).toBe(1);
  });

  it('says what the pane beside the list is for while nothing is open', async () => {
    const { harness, element } = await mount('/shops', {
      split: true,
      emptyKey: 'shops.pick',
    });

    expect(element.querySelector('.hint')?.textContent?.trim()).toBe(
      'shops.pick'
    );

    await TestBed.inject(Router).navigateByUrl('/shops/s1');
    await drawn(harness);
    expect(element.querySelector('.hint')).toBeNull();
  });

  it('says nothing in the empty pane when no key was given', async () => {
    const { element } = await mount('/shops', { split: true });

    expect(element.querySelector('.hint')).toBeNull();
  });

  it('marks a split that sits under a page header', async () => {
    const under = await mount('/shops', { split: true, underHeader: true });
    expect(under.split.classList.contains('under')).toBe(true);

    const alone = await mount('/shops', { split: true });
    expect(alone.split.classList.contains('under')).toBe(false);
  });

  /**
   * Under a header and beside the list, the open row titles a pane. Anywhere
   * else it titles the page: under nothing, or on a narrow screen where the
   * header above is hidden while a row is open.
   */
  it('gives the open row the heading level of where it sits', async () => {
    const level = async (options: Options) =>
      (await mount('/shops/s1', options)).element
        .querySelector('[data-shop-page]')
        ?.textContent?.trim();

    expect(await level({ split: true, underHeader: true })).toBe('2');
    expect(await level({ split: false, underHeader: true })).toBe('1');
    expect(await level({ split: true })).toBe('1');
    expect(await level({ split: false })).toBe('1');
  });

  /**
   * The page is as long as the pane that shows, so hiding the list loses its
   * place. The top is shown when a row opens over it. Beside the list nothing
   * is hidden, and nothing scrolls.
   */
  it('scrolls to the top when a row opens over the list, and not beside it', async () => {
    const narrow = await mount('/shops', { split: false });
    await TestBed.inject(Router).navigateByUrl('/shops/s1');
    await drawn(narrow.harness);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });

    scrollTo.mockClear();
    const wide = await mount('/shops', { split: true });
    await TestBed.inject(Router).navigateByUrl('/shops/s1');
    await drawn(wide.harness);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('puts the list back where it was when the row closes', async () => {
    const frames: FrameRequestCallback[] = [];
    const frame = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => frames.push(callback));
    const { harness } = await mount('/shops', { split: false });
    const router = TestBed.inject(Router);

    Object.defineProperty(window, 'scrollY', {
      value: 640,
      configurable: true,
    });
    await router.navigateByUrl('/shops/s1');
    await drawn(harness);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });

    scrollTo.mockClear();
    await router.navigateByUrl('/shops');
    await drawn(harness);
    // After the list is shown again, which is the next frame.
    expect(scrollTo).not.toHaveBeenCalled();
    frames.forEach((callback) => callback(0));
    expect(scrollTo).toHaveBeenCalledWith({ top: 640 });

    frame.mockRestore();
  });
});
