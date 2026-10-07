import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DASHBOARD_SERVICE,
  DashboardStore,
  type DashboardDocument,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  provideSections,
  type AdminSection,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  defineResource,
  type AnyResourceDescriptor,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { POSTAL_CODES } from './postal-codes';
import { HarvestSetupPage, SETUP_INFO } from './setup-page';

/**
 * Setup: what is set up once and then left alone (admin plan 0044, target 6).
 * The page draws the header and a switch of three parts. Each part draws the
 * rest.
 */

interface Brand extends ResourceRow {
  id: string;
  label: string;
}

/**
 * The registered brands, as far as this page reads them: a name, a segment
 * and what the list is called. The real descriptor is in a library that
 * imports this one.
 */
const BRANDS = defineResource<Brand>({
  name: 'brands',
  segment: 'brands',
  labels: { one: 'brands.registered.one', many: 'brands.registered.many' },
  title: (row) => row.label,
  fields: [{ kind: 'text', name: 'label', label: 'label' }],
  list: { columns: ['label'], compact: ['label'] },
  gateway: () => {
    throw new Error('This spec opens no list.');
  },
});

@Component({ selector: 'lib-test-part', template: '' })
class Part {}

/** The section as the app declares it: two resources held under Setup. */
function section(held: readonly AnyResourceDescriptor[]): AdminSection {
  return {
    key: 'harvest',
    label: 'shell.sections.harvest',
    segment: 'harvest',
    held,
    heldUnder: 'setup',
  };
}

function dashboard(sources: number | null): DashboardDocument {
  return {
    measuredAt: '2026-09-03T10:00:00.000Z',
    harvest:
      sources === null
        ? null
        : {
            runs: { byStatus: [], inWindow: 0 },
            running: null,
            recent: [],
            queues: { entries: [], places: 0, shops: [], brands: 0 },
            sources: { total: sources, enabled: 0 },
          },
  } as unknown as DashboardDocument;
}

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

interface World {
  readonly held?: readonly AnyResourceDescriptor[];
  readonly sources?: number | null;
  readonly url?: string;
}

async function render(world: World = {}) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [HarvestSetupPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideRouter([{ path: '**', component: Part }]),
      provideLocationMocks(),
      provideSections(section(world.held ?? [BRANDS, POSTAL_CODES])),
      {
        provide: DASHBOARD_SERVICE,
        useValue: {
          read: async () =>
            dashboard(world.sources === undefined ? 4 : world.sources),
        },
      },
      {
        provide: Viewport,
        useValue: { compact: signal(false), split: signal(true) },
      },
    ],
  }).compileComponents();

  await TestBed.inject(Router).navigateByUrl(
    world.url ?? '/harvest/setup/sources'
  );

  const fixture = TestBed.createComponent(HarvestSetupPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return fixture as ComponentFixture<HarvestSetupPage>;
}

const parts = (fixture: ComponentFixture<HarvestSetupPage>) =>
  [
    ...fixture.nativeElement.querySelectorAll('.parts a'),
  ] as HTMLAnchorElement[];

afterEach(() => TestBed.inject(DashboardStore).stop());

describe('HarvestSetupPage', () => {
  it('draws the section header, with the info of Setup', async () => {
    const fixture = await render();

    expect(
      fixture.nativeElement.querySelector('lib-harvest-header')
    ).not.toBeNull();
    expect(fixture.componentInstance.info).toBe(SETUP_INFO);
    expect(SETUP_INFO.points.length).toBeLessThanOrEqual(4);
  });

  it('has a switch of three parts, each at its own address', async () => {
    const fixture = await render();

    expect(
      parts(fixture).map((link) => [
        link.getAttribute('data-part'),
        link.getAttribute('href'),
      ])
    ).toEqual([
      ['sources', '/harvest/setup/sources'],
      ['brands', '/harvest/setup/brands'],
      ['postal-codes', '/harvest/setup/postal-codes'],
    ]);
  });

  /**
   * A resource is called what its descriptor calls it, so the switch and the
   * list behind it cannot disagree about a name.
   */
  it('names the two resources as their descriptors do', async () => {
    const fixture = await render({ sources: null });

    expect(parts(fixture).map((link) => link.textContent?.trim())).toEqual([
      'harvest.sources.heading',
      'brands.registered.many',
      POSTAL_CODES.labels.many,
    ]);
  });

  /** An app that did not mount a resource has no link to a missing screen. */
  it('has no entry for a part the app did not mount', async () => {
    const fixture = await render({ held: [POSTAL_CODES] });

    expect(
      parts(fixture).map((link) => link.getAttribute('data-part'))
    ).toEqual(['sources', 'postal-codes']);
  });

  it('keeps the chain sources when no resource is mounted at all', async () => {
    const fixture = await render({ held: [] });

    expect(
      parts(fixture).map((link) => link.getAttribute('data-part'))
    ).toEqual(['sources']);
  });

  describe('the count on the chain sources', () => {
    it('is how many chains have a source row', async () => {
      const fixture = await render({ sources: 4 });

      expect(parts(fixture)[0].querySelector('.count')?.textContent).toBe('4');
    });

    it('is on that part alone', async () => {
      const fixture = await render({ sources: 4 });

      expect(parts(fixture)[1].querySelector('.count')).toBeNull();
      expect(parts(fixture)[2].querySelector('.count')).toBeNull();
    });

    it('is not drawn for none', async () => {
      const fixture = await render({ sources: 0 });

      expect(parts(fixture)[0].querySelector('.count')).toBeNull();
    });

    it('is not drawn when the harvester did not answer', async () => {
      const fixture = await render({ sources: null });

      expect(parts(fixture)[0].querySelector('.count')).toBeNull();
    });
  });

  it('marks the part that is open as the current page', async () => {
    const fixture = await render({ url: '/harvest/setup/postal-codes' });
    await turn();
    fixture.detectChanges();

    const current = parts(fixture).filter(
      (link) => link.getAttribute('aria-current') === 'page'
    );
    expect(current.map((link) => link.getAttribute('data-part'))).toEqual([
      'postal-codes',
    ]);
  });

  it('leaves the rest of the page to the part', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
  });
});
