import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DASHBOARD_SERVICE,
  DashboardStore,
  type DashboardDocument,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { ChainSelect } from './chain-select';
import { ReviewChain } from './review-chain';
import { HarvestReviewPage, REVIEW_INFO } from './review-page';

/**
 * Review: the four queues on one page (admin plan 0044, target 4). The page
 * draws the header, the switch between the queues with what waits in each,
 * and the chain filter the four share. Each queue draws the rest.
 */

@Component({ selector: 'lib-test-queue', template: '' })
class Queue {}

interface Queues {
  readonly entries?: readonly {
    supermarketId: string;
    candidate: number;
    unresolved: number;
  }[];
  readonly places?: number;
  readonly shops?: readonly { supermarketId: string; unmapped: number }[];
  readonly brands?: number | null;
}

function dashboard(queues: Queues | null): DashboardDocument {
  return {
    measuredAt: '2026-09-03T10:00:00.000Z',
    harvest:
      queues === null
        ? null
        : {
            runs: { byStatus: [], inWindow: 0 },
            running: null,
            recent: [],
            queues: {
              entries: [],
              places: 0,
              shops: [],
              brands: 0,
              ...queues,
            },
            sources: { total: 2, enabled: 0 },
          },
  } as unknown as DashboardDocument;
}

const WAITING: Queues = {
  entries: [{ supermarketId: 'sm_mercadona', candidate: 90, unresolved: 6 }],
  shops: [{ supermarketId: 'sm_mercadona', unmapped: 31 }],
  places: 14,
  brands: 7,
};

const drain = async () => {
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }
};

/** A navigation takes more than microtasks to finish, so wait a real turn. */
const turn = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((done) => setTimeout(done));
  }
};

async function render(
  queues: Queues | null = WAITING,
  url = '/harvest/review/products'
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [HarvestReviewPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([{ path: '**', component: Queue }]),
      provideLocationMocks(),
      {
        provide: DASHBOARD_SERVICE,
        useValue: { read: async () => dashboard(queues) },
      },
      {
        provide: Viewport,
        useValue: { compact: signal(false), split: signal(true) },
      },
      {
        provide: ResourceReferences,
        useValue: {
          search: async () => [{ id: 'sm_deza', title: 'Deza' }],
          resolve: async () => null,
        },
      },
    ],
  }).compileComponents();

  await TestBed.inject(Router).navigateByUrl(url);

  const fixture = TestBed.createComponent(HarvestReviewPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return fixture as ComponentFixture<HarvestReviewPage>;
}

const links = (fixture: ComponentFixture<HarvestReviewPage>) =>
  [
    ...fixture.nativeElement.querySelectorAll('.queues a'),
  ] as HTMLAnchorElement[];

const countOn = (link: HTMLAnchorElement): string | null =>
  link.querySelector('.count')?.textContent?.trim() ?? null;

afterEach(() => TestBed.inject(DashboardStore).stop());

describe('HarvestReviewPage', () => {
  it('draws the section header, with the info of Review', async () => {
    const fixture = await render();

    expect(
      fixture.nativeElement.querySelector('lib-harvest-header')
    ).not.toBeNull();
    expect(fixture.componentInstance.info).toBe(REVIEW_INFO);
    expect(REVIEW_INFO.points).toEqual([
      'harvest.review.info.holds',
      'harvest.review.info.decide',
    ]);
  });

  it('has a switch of four queues, each at its own address', async () => {
    const fixture = await render();

    expect(
      links(fixture).map((link) => [
        link.getAttribute('data-queue'),
        link.getAttribute('href'),
      ])
    ).toEqual([
      ['products', '/harvest/review/products'],
      ['shops', '/harvest/review/shops'],
      ['places', '/harvest/review/places'],
      ['brands', '/harvest/review/brands'],
    ]);
  });

  it('names each queue with a translation key', async () => {
    const fixture = await render(null);

    expect(links(fixture).map((link) => link.textContent?.trim())).toEqual([
      'harvest.review.queue.products',
      'harvest.review.queue.shops',
      'harvest.review.queue.places',
      'harvest.review.queue.brands',
    ]);
  });

  /** The counts the dashboard read carries, one per queue. */
  it('shows how many wait in each queue', async () => {
    const fixture = await render();

    expect(links(fixture).map(countOn)).toEqual(['96', '31', '14', '7']);
  });

  it('says a count is waiting work, for a screen reader', async () => {
    const fixture = await render();

    expect(
      links(fixture)[0].querySelector('.count')?.getAttribute('aria-label')
    ).toBe('shell.waiting');
  });

  /** A queue with nothing behind it does not need a zero beside its name. */
  it('draws no count for a queue with nothing waiting', async () => {
    const fixture = await render({ ...WAITING, places: 0, shops: [] });

    expect(links(fixture).map(countOn)).toEqual(['96', null, null, '7']);
  });

  /** The brand registry did not answer, so that one count is not known. */
  it('draws no count for a queue whose count is not known', async () => {
    const fixture = await render({ ...WAITING, brands: null });

    expect(links(fixture).map(countOn)).toEqual(['96', '31', '14', null]);
  });

  it('draws no count at all when the harvester did not answer', async () => {
    const fixture = await render(null);

    expect(links(fixture).map(countOn)).toEqual([null, null, null, null]);
  });

  it('marks the queue that is open as the current page', async () => {
    const fixture = await render(WAITING, '/harvest/review/shops');
    await turn();
    fixture.detectChanges();

    const current = links(fixture).filter(
      (link) => link.getAttribute('aria-current') === 'page'
    );
    expect(current.map((link) => link.getAttribute('data-queue'))).toEqual([
      'shops',
    ]);
  });

  describe('the chain the four queues share', () => {
    /** A move from one queue to the next keeps the chain. */
    it('rides on every link of the switch', async () => {
      const fixture = await render(
        WAITING,
        '/harvest/review/products?chain=sm_deza'
      );

      expect(links(fixture).map((link) => link.getAttribute('href'))).toEqual([
        '/harvest/review/products?chain=sm_deza',
        '/harvest/review/shops?chain=sm_deza',
        '/harvest/review/places?chain=sm_deza',
        '/harvest/review/brands?chain=sm_deza',
      ]);
    });

    it('is shown in the chain control', async () => {
      const fixture = await render(
        WAITING,
        '/harvest/review/products?chain=sm_deza'
      );

      const select = fixture.debugElement.query(By.directive(ChainSelect))
        .componentInstance as ChainSelect;
      expect(select.value()).toBe('sm_deza');
      expect(select.controlId()).toBe('review-chain');
      // The visible label points at the control.
      expect(
        fixture.nativeElement.querySelector('label[for="review-chain"]')
      ).not.toBeNull();
    });

    it('is chosen through the control, which writes the address', async () => {
      const fixture = await render();
      const chain = TestBed.inject(ReviewChain);
      const choose = jest.spyOn(chain, 'choose');

      fixture.debugElement
        .query(By.directive(ChainSelect))
        .triggerEventHandler('valueChange', 'sm_deza');
      await turn();
      fixture.detectChanges();

      expect(choose).toHaveBeenCalledWith('sm_deza');
      expect(TestBed.inject(Router).url).toBe(
        '/harvest/review/products?chain=sm_deza'
      );
      expect(links(fixture)[1].getAttribute('href')).toBe(
        '/harvest/review/shops?chain=sm_deza'
      );
    });
  });

  it('leaves the rest of the page to the queue', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });
});
