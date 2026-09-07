import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  POSTAL_CODE_SERVICE,
  PostalCodeMemory,
  type HarvestServiceI,
  type PostalCodeServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { PostalCodeDetailPage } from './postal-code-detail-page';

/**
 * One postal code, and the three questions an operator asks about it (admin plan
 * 0021, sections 5 and 8).
 *
 * The property worth asserting hardest is that the panels are **independent**. A
 * core outage empties the waiting panel and leaves the other three, because the
 * page is four questions and three of them still have answers.
 */

const drain = async () => {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
  }
};

function failing(): GatewayError {
  return new GatewayError({ code: '', status: 500, correlationId: '' });
}

async function render(
  postalCode: string,
  overrides: {
    harvest?: HarvestServiceI;
    postalCodes?: PostalCodeServiceI;
  } = {}
): Promise<ComponentFixture<PostalCodeDetailPage>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [PostalCodeDetailPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideLocationMocks(),
      {
        provide: HARVEST_SERVICE,
        useValue: overrides.harvest ?? new HarvestMemory(),
      },
      {
        provide: POSTAL_CODE_SERVICE,
        useValue: overrides.postalCodes ?? new PostalCodeMemory(),
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: new Map([['id', postalCode]]),
            queryParamMap: new Map(),
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(PostalCodeDetailPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();
  return fixture;
}

const headings = (fixture: ComponentFixture<unknown>): string[] =>
  fixture.debugElement
    .queryAll(By.css('h2'))
    .map(
      (node) => (node.nativeElement as HTMLElement).textContent?.trim() ?? ''
    );

const states = (fixture: ComponentFixture<unknown>): string[] =>
  fixture.debugElement
    .queryAll(By.css('.state'))
    .map(
      (node) => (node.nativeElement as HTMLElement).textContent?.trim() ?? ''
    );

describe('the postal code detail page', () => {
  it('draws four panels, one per question', async () => {
    const fixture = await render('14013');

    expect(headings(fixture)).toEqual([
      'harvest.postalCodes.detail.queue',
      'harvest.postalCodes.detail.near',
      'harvest.postalCodes.detail.places',
      'harvest.postalCodes.detail.waiting',
    ]);
  });

  it('finds the row, its neighbours, its places and its demand', async () => {
    const fixture = await render('14013');
    const page = fixture.componentInstance;

    expect(page.row()?.id).toBe('postal-14013');
    // Nearest first, and never the code asked about.
    expect(page.near().length).toBeGreaterThan(0);
    expect(page.near().map((code) => code.postalCode)).not.toContain('14013');
    expect(page.shopCount()).toBe(3);
    expect(page.usage()?.mainProfiles).toBe(9);
  });

  /**
   * Section 5's last rule. Losing one service costs one panel.
   */
  it('keeps the other three panels when core does not answer', async () => {
    const memory = new PostalCodeMemory();
    const fixture = await render('14013', {
      postalCodes: {
        usage: async () => {
          throw failing();
        },
        nearby: (country, postalCode, radiusMetres) =>
          memory.nearby(country, postalCode, radiusMetres),
        shipped: (country, postalCode) => memory.shipped(country, postalCode),
      },
    });
    const page = fixture.componentInstance;

    expect(page.usageErrorKey()).toBe('resource.error.unknown');
    expect(page.row()?.id).toBe('postal-14013');
    // Four headings still, because a failed panel says so inside itself rather
    // than disappearing.
    expect(headings(fixture)).toHaveLength(4);
  });

  it('keeps the other three panels when the harvester does not answer', async () => {
    const harvest = Object.assign(Object.create(new HarvestMemory()), {
      listPostalCodes: async () => {
        throw failing();
      },
      listPlaces: async () => {
        throw failing();
      },
    }) as HarvestServiceI;

    const fixture = await render('14013', { harvest });
    const page = fixture.componentInstance;

    expect(page.rowErrorKey()).toBe('resource.error.unknown');
    expect(page.usage()?.mainProfiles).toBe(9);
    expect(headings(fixture)).toHaveLength(4);
  });

  /**
   * A code catalog has never heard of is a different fact from a code with no
   * neighbours, and the panel says which. Drawing an empty list for both would
   * read as "nothing is nearby" for a code that does not exist.
   */
  it('says a code is not in the national table rather than showing no neighbours', async () => {
    const fixture = await render('99999');

    expect(fixture.componentInstance.known()).toBe(false);
    expect(states(fixture)).toContain('harvest.postalCodes.detail.notShipped');
    expect(states(fixture)).not.toContain('harvest.postalCodes.detail.noNear');
  });

  /** A guessed postal code says that it was guessed wherever it is shown. */
  it('marks a place whose code was worked out rather than tagged', async () => {
    const fixture = await render('14013');
    const page = fixture.componentInstance;

    expect(page.sourceKey({ postalCodeSource: 'DERIVED' } as never)).toBe(
      'harvest.postalCodes.detail.derived'
    );
    expect(page.sourceKey({ postalCodeSource: 'SOURCE' } as never)).toBe(
      'harvest.postalCodes.detail.tagged'
    );
  });
});
