import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
} from '@portfolio/luna-shopper-admin/data-access';
import { SUPERMARKETS } from '@portfolio/luna-shopper-admin/feature-catalog';
import { provideResources } from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { placeGroupRows } from './place-groups';
import { PlaceGroupsPage } from './place-groups-page';

/** Admin plan 0034, section 4: the places queue, read by chain. */

const drain = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

function group(
  over: Partial<Wire.HarvestDiscoveredPlaceGroup>
): Wire.HarvestDiscoveredPlaceGroup {
  return {
    brandKey: null,
    brandName: null,
    count: 1,
    known: false,
    supermarketId: null,
    sample: [],
    ...over,
  };
}

describe('placeGroupRows', () => {
  it('puts the largest group first and the one with no brand last', () => {
    const rows = placeGroupRows({
      groups: [
        group({ brandName: null, count: 40 }),
        group({ brandKey: 'Q925132', brandName: 'Dia', count: 3 }),
        group({ brandName: 'Deza', count: 8 }),
      ],
    });

    expect(rows.map((row) => row.name)).toEqual(['Deza', 'Dia', '']);
  });

  it('names the chain only for a group the catalog knows', () => {
    const [known, unknown] = placeGroupRows({
      groups: [
        group({ brandName: 'A', count: 2, known: true, supermarketId: 'sm' }),
        group({ brandName: 'B', count: 1, known: false, supermarketId: 'x' }),
      ],
    });

    expect(known.supermarketId).toBe('sm');
    expect(unknown.supermarketId).toBe('');
  });
});

describe('the place groups view', () => {
  async function render() {
    const memory = new HarvestMemory();
    const groups = jest.spyOn(memory, 'placeGroups');

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PlaceGroupsPage, RokuTranslatorTestingModule.forTesting()],
      providers: [
        ContentLocaleStore,
        ServerReachability,
        provideRouter([]),
        provideLocationMocks(),
        provideResources(SUPERMARKETS),
        { provide: HARVEST_SERVICE, useValue: memory },
        {
          provide: DEPLOYMENT_SERVICE,
          useValue: {
            read: async () => ({
              deployment: 'development',
              devAutologin: false,
            }),
          },
        },
        DeploymentStore,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PlaceGroupsPage);
    fixture.detectChanges();
    await drain();
    fixture.detectChanges();
    return { fixture, groups };
  }

  it('reads places/groups and draws one card per group', async () => {
    const { fixture, groups } = await render();

    expect(groups).toHaveBeenCalledWith({ sampleSize: 3 });
    const cards = fixture.nativeElement.querySelectorAll('.groups li');
    expect(cards.length).toBe(fixture.componentInstance.rows().length);
    expect(cards.length).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).toContain('Dia');
  });

  /**
   * Backend plan 0154: an unbranded place is grouped by what it prints, so the
   * Deza place is its own group rather than inside somebody else's.
   */
  it('groups an unbranded place by its printed brand', async () => {
    const { fixture } = await render();

    const deza = fixture.componentInstance
      .rows()
      .find((row) => row.name === 'Deza');
    expect(deza?.brandKey).toBe('');
    expect(deza?.sample).toEqual(['Supermercado Deza']);
  });

  it('links back to the queue', async () => {
    const { fixture } = await render();

    expect(
      fixture.nativeElement.querySelector('header a').getAttribute('href')
    ).toBe('/harvest/places');
  });
});
