import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  provideSections,
  RESOURCE_DESCRIPTOR,
  RESOURCE_LIST_EMBED,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { SOURCES } from './sources';
import { SourcesGateway } from './sources-gateway';
import { SourcesTab } from './sources-tab';

/**
 * The Sources part of Setup (admin plan 0059, targets 2 and 10): the generic
 * list of the chain sources, with the line about OpenStreetMap under it.
 * What it says with no harvester is in `harvest-absent.spec.ts`.
 *
 * The translator double answers a key with the key.
 */

const settle = async (fixture: ComponentFixture<SourcesTab>) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
};

async function render(harvest = new HarvestMemory()) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SourcesTab, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: harvest },
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
      provideSections({
        key: 'harvest',
        label: '',
        segment: 'harvest',
        held: [SOURCES],
        heldUnder: 'setup',
      }),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            data: {
              [RESOURCE_DESCRIPTOR]: SOURCES,
              [RESOURCE_LIST_EMBED]: 'tab',
            },
          },
        },
      },
    ],
  }).compileComponents();

  await TestBed.inject(DeploymentStore).load();

  const fixture = TestBed.createComponent(SourcesTab);
  fixture.detectChanges();
  await settle(fixture);
  return { fixture, harvest, host: fixture.nativeElement as HTMLElement };
}

describe('the Sources part of Setup', () => {
  it('draws the generic list, with no header and no switch on a row', async () => {
    const { host } = await render();

    expect(host.querySelector('lib-resource-list-page')).not.toBeNull();
    expect(host.querySelector('lib-harvest-notice')).toBeNull();
    // The Setup page above this part draws the header.
    expect(host.querySelector('lib-page-header')).toBeNull();
    // Whether a chain may be fetched is the action of a row, with a question.
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });

  it('says the state of each source: fetched, or off', async () => {
    const harvest = new HarvestMemory();
    const page = await harvest.listSources({});
    const [first, second] = page.items;
    await harvest.setSourceEnabled(first.supermarketId, true);
    await harvest.setSourceEnabled(second.supermarketId, false);

    const { host } = await render(harvest);

    expect(host.textContent).toContain('harvest.sources.state.fetched');
    expect(host.textContent).toContain('harvest.sources.state.off');
  });

  it('says OpenStreetMap is always asked, as one line under the list', async () => {
    const { host } = await render();

    const always = host.querySelector('.always');
    const list = host.querySelector('lib-resource-list-page');
    expect(always?.textContent).toContain('harvest.sources.osmAlways');
    expect(list?.contains(always)).toBe(false);
    expect(
      (list as Node).compareDocumentPosition(always as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  /** With no source, the list says what that costs: no run can be started. */
  it('says that no chain has a source, when the list is empty', async () => {
    const harvest = new HarvestMemory();
    jest
      .spyOn(harvest, 'listSources')
      .mockResolvedValue({ items: [], nextCursor: null });

    const { host } = await render(harvest);

    expect(host.querySelector('lib-resource-list')?.textContent).toContain(
      'harvest.sources.empty'
    );
    expect(host.textContent).not.toContain('resource.list.empty');
  });

  /**
   * The gateway is one for the whole app, so what it remembers outlives this
   * part. Where the harvester is not deployed the notice has no retry, so a
   * read that failed once was the answer of every later visit.
   */
  it('reads the list again on each visit, after a read that failed', async () => {
    const harvest = new HarvestMemory();
    const list = jest
      .spyOn(harvest, 'listSources')
      .mockRejectedValueOnce(
        new GatewayError({ code: '', status: 0, correlationId: '' })
      );

    const first = await render(harvest);
    expect(first.host.querySelector('lib-harvest-notice')).not.toBeNull();
    expect(TestBed.inject(SourcesGateway).listFailed()).toBe(true);
    first.fixture.destroy();

    // The same injector, so the same gateway: a second visit to the tab.
    const fixture = TestBed.createComponent(SourcesTab);
    fixture.detectChanges();
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;

    expect(list).toHaveBeenCalledTimes(2);
    expect(host.querySelector('lib-harvest-notice')).toBeNull();
    expect(host.querySelector('lib-resource-list-page')).not.toBeNull();
  });

  /** The retry of the notice reads the list again, from the start. */
  it('reads the list again when the notice is asked to retry', async () => {
    const harvest = new HarvestMemory();
    const list = jest
      .spyOn(harvest, 'listSources')
      .mockRejectedValueOnce(
        new GatewayError({ code: '', status: 0, correlationId: '' })
      );

    const { fixture, host } = await render(harvest);
    expect(host.querySelector('lib-harvest-notice')).not.toBeNull();
    expect(host.querySelector('.always')).toBeNull();

    host.querySelector<HTMLButtonElement>('lib-harvest-notice button')?.click();
    fixture.detectChanges();
    await settle(fixture);

    expect(list).toHaveBeenCalledTimes(2);
    expect(host.querySelector('lib-harvest-notice')).toBeNull();
    expect(host.querySelector('lib-resource-list-page')).not.toBeNull();
  });
});
