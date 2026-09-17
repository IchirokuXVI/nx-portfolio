import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  MERCADONA_WEEKLY_PRESET,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { PresetsPage } from './presets-page';
import { RunRequestForm } from './run-request-form';

/**
 * The presets screen (admin plan 0030, section 3), over the memory back end.
 *
 * The seed holds one Mercadona preset walking two warehouses with a copy, and
 * a run started from it, so the list has a summary and a latest run to draw.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const NATIONAL = '55555555-5555-4555-8555-555555555551';
const W4661 = '55555555-5555-4555-8555-555555555554';
const W4804 = '55555555-5555-4555-8555-555555555555';

const SCOPES = [
  {
    id: NATIONAL,
    kind: 'NATIONAL',
    externalKey: null,
    label: null,
    priority: 1000,
  },
  {
    id: W4661,
    kind: 'LOCAL_AREA',
    externalKey: '4661',
    label: null,
    priority: 200,
  },
  {
    id: W4804,
    kind: 'LOCAL_AREA',
    externalKey: '4804',
    label: null,
    priority: 200,
  },
];

const drain = async () => {
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }
};

interface Recorded {
  readonly memory: HarvestMemory;
  readonly updated: unknown[];
  readonly created: unknown[];
  readonly started: string[];
}

async function render(): Promise<{
  fixture: ComponentFixture<PresetsPage>;
  recorded: Recorded;
}> {
  const memory = new HarvestMemory();
  const recorded: Recorded = { memory, updated: [], created: [], started: [] };

  const service = {
    ...({} as HarvestServiceI),
    readSource: (id: string) => memory.readSource(id),
    listPresets: (chain?: string, cursor?: string) =>
      memory.listPresets(chain, cursor),
    createPreset: (chain: string, name: string, input: never) => {
      recorded.created.push({ chain, name, input });
      return memory.createPreset(chain, name, input);
    },
    updatePreset: (id: string, patch: never) => {
      recorded.updated.push({ id, patch });
      return memory.updatePreset(id, patch);
    },
    deletePreset: (id: string) => memory.deletePreset(id),
    startPreset: (id: string) => {
      recorded.started.push(id);
      return memory.startPreset(id);
    },
  } as unknown as HarvestServiceI;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [PresetsPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: () => ({
            list: async () => ({ items: SCOPES, nextCursor: null }),
          }),
        },
      },
      {
        provide: ResourceReferences,
        useValue: {
          search: async () => [],
          resolve: async (_resource: string, id: string) => ({
            id,
            title: id,
          }),
        },
      },
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

  const fixture = TestBed.createComponent(PresetsPage);
  fixture.detectChanges();
  fixture.componentInstance.chooseChain(MERCADONA);
  await settle(fixture);

  return { fixture, recorded };
}

async function settle(fixture: ComponentFixture<PresetsPage>) {
  for (let round = 0; round < 4; round++) {
    await drain();
    fixture.detectChanges();
  }
}

const text = (fixture: ComponentFixture<PresetsPage>): string =>
  fixture.nativeElement.textContent;

function formOf(fixture: ComponentFixture<PresetsPage>): RunRequestForm {
  return fixture.debugElement.query(By.directive(RunRequestForm))
    .componentInstance as RunRequestForm;
}

const ticked = (checked: boolean) =>
  ({ target: { checked } }) as unknown as Event;

describe('the presets screen, the list', () => {
  it('lists a chain presets with a summary and the latest run', async () => {
    const { fixture } = await render();
    const page = fixture.componentInstance;

    expect(page.presets().map((preset) => preset.name)).toEqual([
      'Weekly warehouses',
    ]);
    expect(page.summaryOf(page.presets()[0])).toEqual([
      { key: 'harvest.presets.summary.warehouses', args: { count: 2 } },
      { key: 'harvest.presets.summary.copies', args: { count: 1 } },
      { key: 'harvest.runs.start.writes.PRICES_AND_AVAILABILITY' },
      { key: 'harvest.presets.summary.details.NEW' },
    ]);
    expect(text(fixture)).toContain('Weekly warehouses');
    expect(text(fixture)).toContain('harvest.status.COMPLETED');

    const last: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a.last-run');
    expect(last.getAttribute('href')).toBe(
      '/harvest/runs/run-catalog-completed'
    );
  });
});

describe('the presets screen, starting a run', () => {
  it('calls the route and goes to the runs page with the run highlighted', async () => {
    const { fixture, recorded } = await render();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    // The seed holds a running walk, and one harvester runs one thing.
    await recorded.memory.abortRun('run-catalog-running');

    await fixture.componentInstance.start(
      fixture.componentInstance.presets()[0]
    );

    expect(recorded.started).toEqual([MERCADONA_WEEKLY_PRESET]);
    const [commands, extras] = navigate.mock.calls[0];
    expect(commands).toEqual(['/', 'harvest', 'runs']);
    expect(extras?.queryParams?.['run']).toEqual(expect.any(String));
  });

  it('shows a refusal on the row, with the server words', async () => {
    const { fixture } = await render();
    const page = fixture.componentInstance;

    // The seeded running walk is still active, so this is a 409.
    await page.start(page.presets()[0]);
    fixture.detectChanges();

    expect(page.refusalOf(MERCADONA_WEEKLY_PRESET)?.key).toBe(
      'harvest.presets.alreadyRunning'
    );
    expect(text(fixture)).toContain('harvest.presets.alreadyRunning');
  });
});

describe('the presets screen, editing', () => {
  it('opens the form on the preset input and saves the changed input', async () => {
    const { fixture, recorded } = await render();
    const page = fixture.componentInstance;

    page.openEdit(page.presets()[0]);
    await settle(fixture);
    const form = formOf(fixture);

    expect(form.priceScopeIds()).toEqual([W4661, W4804]);
    expect(form.copiesOf(W4661)).toEqual([NATIONAL]);
    expect(page.name()).toBe('Weekly warehouses');

    form.toggleScope(W4804, ticked(false));
    fixture.detectChanges();
    form.submit();
    await settle(fixture);

    expect(recorded.updated).toEqual([
      {
        id: MERCADONA_WEEKLY_PRESET,
        patch: {
          name: 'Weekly warehouses',
          input: {
            mode: 'CATALOG_DISCOVERY',
            priceScopeIds: [W4661],
            scopeCopies: [{ from: W4661, to: [NATIONAL] }],
            writes: 'PRICES_AND_AVAILABILITY',
            details: 'NEW',
          },
        },
      },
    ]);
    expect(page.editing()).toBeNull();
  });

  it('shows a duplicate name under the name field', async () => {
    const { fixture, recorded } = await render();
    const page = fixture.componentInstance;

    page.openNew();
    await settle(fixture);
    page.onNameChange('WEEKLY warehouses');
    const form = formOf(fixture);
    form.toggleScope(W4661, ticked(true));
    fixture.detectChanges();
    form.submit();
    await settle(fixture);

    expect(recorded.created).toHaveLength(1);
    expect(page.nameTaken()).toBe(true);
    expect(page.editing()).not.toBeNull();
    expect(text(fixture)).toContain('harvest.presets.nameTaken');
  });

  it('offers no file import and no chain picker inside the editor', async () => {
    const { fixture } = await render();

    fixture.componentInstance.openNew();
    await settle(fixture);
    const form = formOf(fixture);

    expect(form.modeOptions()).not.toContain('FILE_IMPORT');
    expect(form.chainLocked()).toBe(true);
    expect(form.supermarketId()).toBe(MERCADONA);
  });
});

describe('the presets screen, deleting', () => {
  it('confirms, then removes the row', async () => {
    const { fixture } = await render();
    const page = fixture.componentInstance;

    page.pendingDelete.set(page.presets()[0]);
    fixture.detectChanges();
    expect(text(fixture)).toContain('harvest.presets.delete.body');

    await page.confirmDelete(page.presets()[0]);
    fixture.detectChanges();

    expect(page.presets()).toEqual([]);
    expect(page.pendingDelete()).toBeNull();
    expect(text(fixture)).toContain('harvest.presets.empty');
  });
});
