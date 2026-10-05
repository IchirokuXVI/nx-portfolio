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
import { PRESETS_CHAIN_KEY, PresetsPanel } from './presets-panel';
import { RunRequestForm } from './run-request-form';

/**
 * The presets (admin plan 0030, section 3), over the memory back end. A panel
 * of the Runs tab since admin plan 0044, and no page of its own.
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

/** A second chain, which the seed holds no preset for. */
const CARREFOUR = '22222222-2222-4222-8222-222222222222';

/**
 * Where the panel is opened, and whether a chain is chosen by hand afterwards.
 * By default the spec chooses Mercadona, as a person does with the picker.
 */
interface RenderOptions {
  readonly url?: string;
  readonly choose?: boolean;
}

beforeEach(() => localStorage.removeItem(PRESETS_CHAIN_KEY));
afterEach(() => localStorage.removeItem(PRESETS_CHAIN_KEY));

async function render(options: RenderOptions = {}): Promise<{
  fixture: ComponentFixture<PresetsPanel>;
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
    imports: [PresetsPanel, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([{ path: '**', component: PresetsPanel }]),
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

  if (options.url !== undefined) {
    await TestBed.inject(Router).navigateByUrl(options.url);
  }

  const fixture = TestBed.createComponent(PresetsPanel);
  fixture.detectChanges();
  if (options.choose !== false) {
    fixture.componentInstance.chooseChain(MERCADONA);
  }
  await settle(fixture);

  return { fixture, recorded };
}

async function settle(fixture: ComponentFixture<PresetsPanel>) {
  for (let round = 0; round < 4; round++) {
    await drain();
    fixture.detectChanges();
  }
}

const text = (fixture: ComponentFixture<PresetsPanel>): string =>
  fixture.nativeElement.textContent;

function formOf(fixture: ComponentFixture<PresetsPanel>): RunRequestForm {
  return fixture.debugElement.query(By.directive(RunRequestForm))
    .componentInstance as RunRequestForm;
}

const ticked = (checked: boolean) =>
  ({ target: { checked } }) as unknown as Event;

describe('the presets panel, the list', () => {
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

/**
 * The chain is remembered (admin plan 0044, target 5). A person starts the
 * same chain's presets day after day, so the panel opens where it was left.
 */
describe('the presets panel, the chain it opens on', () => {
  it('opens on no chain in a browser that remembers none', async () => {
    const { fixture } = await render({ choose: false });

    expect(fixture.componentInstance.supermarketId()).toBe('');
    expect(text(fixture)).toContain('harvest.presets.chooseChain');
  });

  it('remembers the chain that was chosen', async () => {
    await render();

    expect(localStorage.getItem(PRESETS_CHAIN_KEY)).toBe(MERCADONA);
  });

  it('opens on the remembered chain when the address names none', async () => {
    localStorage.setItem(PRESETS_CHAIN_KEY, MERCADONA);

    const { fixture } = await render({ choose: false });

    expect(fixture.componentInstance.supermarketId()).toBe(MERCADONA);
    expect(
      fixture.componentInstance.presets().map((preset) => preset.name)
    ).toEqual(['Weekly warehouses']);
  });

  /** A link that names a chain wins over the remembered one. */
  it('opens on the chain the address names, whatever is remembered', async () => {
    localStorage.setItem(PRESETS_CHAIN_KEY, CARREFOUR);

    const { fixture } = await render({
      url: `/?chain=${MERCADONA}&preset=${MERCADONA_WEEKLY_PRESET}`,
      choose: false,
    });

    expect(fixture.componentInstance.supermarketId()).toBe(MERCADONA);
    expect(fixture.componentInstance.highlighted()).toBe(
      MERCADONA_WEEKLY_PRESET
    );
    expect(fixture.nativeElement.querySelector('li.highlighted')).not.toBeNull();
  });

  it('forgets the chain when the picker is cleared', async () => {
    const { fixture } = await render();

    fixture.componentInstance.chooseChain('');

    expect(localStorage.getItem(PRESETS_CHAIN_KEY)).toBeNull();
  });
});

describe('the presets panel, starting a run', () => {
  /**
   * The panel is on the Runs tab, so a start goes nowhere: it tells the page,
   * and the page reads its runs again.
   */
  it('calls the route, says which run started and does not navigate', async () => {
    const { fixture, recorded } = await render();
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate');
    const navigateByUrl = jest.spyOn(router, 'navigateByUrl');
    const started: string[] = [];
    fixture.componentInstance.started.subscribe((run) => started.push(run.id));
    // The seed holds a running walk, and one harvester runs one thing.
    await recorded.memory.abortRun('run-catalog-running');

    await fixture.componentInstance.start(
      fixture.componentInstance.presets()[0]
    );
    await settle(fixture);

    expect(recorded.started).toEqual([MERCADONA_WEEKLY_PRESET]);
    expect(started).toEqual([expect.any(String)]);
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    // The row says how its last run ended, and that is this run now.
    expect(fixture.componentInstance.presets()[0].lastRun?.id).toBe(started[0]);
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

/**
 * A row is a name, a line that says what it does, how its last run ended and
 * "Start". Edit and delete are for the day the presets are put in order.
 */
describe('the presets panel, "Edit presets"', () => {
  const query = (fixture: ComponentFixture<PresetsPanel>, selector: string) =>
    fixture.nativeElement.querySelector(selector) as HTMLButtonElement | null;

  it('shows Start alone on a row until it is on', async () => {
    const { fixture } = await render();

    expect(query(fixture, '[data-start]')).not.toBeNull();
    expect(query(fixture, '[data-edit]')).toBeNull();
    expect(query(fixture, '[data-delete]')).toBeNull();
  });

  it('shows edit and delete on each row while it is on, and hides them again', async () => {
    const { fixture } = await render();
    const toggle = query(fixture, '[data-edit-presets]') as HTMLButtonElement;

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(query(fixture, '[data-edit]')).not.toBeNull();
    expect(query(fixture, '[data-delete]')).not.toBeNull();
    expect(query(fixture, '[data-start]')).not.toBeNull();

    toggle.click();
    fixture.detectChanges();

    expect(query(fixture, '[data-edit]')).toBeNull();
    expect(query(fixture, '[data-delete]')).toBeNull();
  });

  it('opens the editor from a row\'s edit button', async () => {
    const { fixture } = await render();

    (query(fixture, '[data-edit-presets]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (query(fixture, '[data-edit]') as HTMLButtonElement).click();
    await settle(fixture);

    expect(fixture.componentInstance.editing()?.preset?.id).toBe(
      MERCADONA_WEEKLY_PRESET
    );
  });

  it('draws no page header of its own', async () => {
    const { fixture } = await render();

    expect(fixture.nativeElement.querySelector('lib-page-header')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
  });
});

describe('the presets panel, editing', () => {
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

describe('the presets panel, deleting', () => {
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
