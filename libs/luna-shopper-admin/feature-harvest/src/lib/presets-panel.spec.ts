import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  DEZA_CATALOG_PRESET,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  MERCADONA_SUNDAY_SCHEDULE,
  MERCADONA_WEEKDAYS_SCHEDULE,
  MERCADONA_WEEKLY_PRESET,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  provideSections,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { PRESETS_CHAIN_KEY, PresetsPanel } from './presets-panel';
import { RunRequestForm } from './run-request-form';
import { SCHEDULES } from './schedules';

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
  /** The chains whose probes were read, once per read. */
  readonly probeReads: string[];
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
  const recorded: Recorded = {
    memory,
    updated: [],
    created: [],
    started: [],
    probeReads: [],
  };

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
    listSchedules: (query: never) => memory.listSchedules(query),
    listProbes: (chain: string, query: never) => {
      recorded.probeReads.push(chain);
      return memory.listProbes(chain, query);
    },
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
      // Where a schedule is, for the links under each preset.
      provideSections({
        key: 'harvest',
        label: '',
        segment: 'harvest',
        held: [SCHEDULES],
        heldUnder: 'setup',
      }),
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
    expect(
      fixture.nativeElement.querySelector('li.highlighted')
    ).not.toBeNull();
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

  it("opens the editor from a row's edit button", async () => {
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
    const { fixture, recorded } = await render();
    const page = fixture.componentInstance;
    // A preset a schedule names cannot be deleted, so the two seeded ones go.
    await recorded.memory.deleteSchedule(MERCADONA_WEEKDAYS_SCHEDULE);
    await recorded.memory.deleteSchedule(MERCADONA_SUNDAY_SCHEDULE);

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

/**
 * When a preset runs by itself (admin plan 0067, target 9): one line under
 * each preset, with each schedule as a link to its page and the way to add
 * one with the preset chosen.
 */
describe('the presets panel, schedules', () => {
  it('draws the schedules of each preset under it, each a link to its page', async () => {
    const { fixture } = await render();
    const page = fixture.componentInstance;

    const lines = page.schedulesOf(MERCADONA_WEEKLY_PRESET);
    expect(lines.map((line) => [line.id, line.enabled])).toEqual(
      expect.arrayContaining([
        [MERCADONA_WEEKDAYS_SCHEDULE, true],
        [MERCADONA_SUNDAY_SCHEDULE, false],
      ])
    );
    expect(lines[0].cadence).toBe('harvest.schedules.cadence.days');

    const links = [
      ...fixture.nativeElement.querySelectorAll('[data-schedule]'),
    ].map((link: HTMLAnchorElement) => link.getAttribute('href'));
    expect(links).toEqual(
      expect.arrayContaining([
        `/harvest/setup/schedules/${MERCADONA_WEEKDAYS_SCHEDULE}`,
        `/harvest/setup/schedules/${MERCADONA_SUNDAY_SCHEDULE}`,
      ])
    );
    // The one that is off says so.
    expect(text(fixture)).toContain('harvest.schedules.state.off');
  });

  it('adds a schedule with the preset chosen', async () => {
    const { fixture } = await render();

    const add = fixture.nativeElement.querySelector(
      '[data-add-schedule]'
    ) as HTMLAnchorElement;

    expect(add.getAttribute('href')).toBe(
      `/harvest/setup/schedules/new?presetId=${MERCADONA_WEEKLY_PRESET}`
    );
  });

  it('says in the dialog that a schedule names the preset it refused to delete', async () => {
    const { fixture } = await render();
    const page = fixture.componentInstance;
    const preset = page.presets()[0];

    page.askDelete(preset);
    await page.confirmDelete(preset);
    fixture.detectChanges();

    expect(page.pendingDelete()).toBe(preset);
    expect(page.deleteScheduled()).toEqual({
      count: 2,
      when: 'harvest.schedules.cadence.days; harvest.schedules.cadence.days',
    });
    expect(
      fixture.nativeElement.querySelector('[data-delete-scheduled]')
        ?.textContent
    ).toContain('harvest.schedules.panel.deleteRefused');
  });

  it('still lists the presets when the schedules cannot be read', async () => {
    const { fixture, recorded } = await render({ choose: false });
    jest
      .spyOn(recorded.memory, 'listSchedules')
      .mockRejectedValue(new Error('down'));

    fixture.componentInstance.chooseChain(MERCADONA);
    await settle(fixture);

    expect(fixture.componentInstance.presets()).toHaveLength(1);
    expect(
      fixture.componentInstance.schedulesOf(MERCADONA_WEEKLY_PRESET)
    ).toEqual([]);
  });
});

/**
 * The notice on a preset's row (admin plan 0069, target 2). The seed's DEZA
 * probe is red behind nothing and Mercadona's is green, so the two chains are
 * the two cases.
 */
describe('the presets panel, a red probe', () => {
  const DEZA = '33333333-3333-4333-8333-333333333333';

  async function onDeza() {
    const rendered = await render({ choose: false });
    rendered.fixture.componentInstance.chooseChain(DEZA);
    await settle(rendered.fixture);
    return rendered;
  }

  it('reads the chain probes once, for every row', async () => {
    const { fixture, recorded } = await onDeza();
    await recorded.memory.createPreset(DEZA, 'Shops', {
      mode: 'STORE_DISCOVERY',
    });
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(fixture.componentInstance.presets()).toHaveLength(2);
    expect(recorded.probeReads).toEqual([DEZA]);
  });

  it('draws the notice on each row whose run reads the chain', async () => {
    const { fixture, recorded } = await onDeza();
    await recorded.memory.createPreset(DEZA, 'Shops', {
      mode: 'STORE_DISCOVERY',
    });
    await fixture.componentInstance.load();
    await settle(fixture);

    const rows: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.presets li')
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(
        row.querySelector('[data-probe-notice="UNREACHABLE"]')
      ).not.toBeNull();
    }
    expect(
      fixture.componentInstance.probeNoticeOf(
        fixture.componentInstance.presets()[0]
      )
    ).toEqual({
      chain: DEZA,
      verdict: expect.objectContaining({ status: 'UNREACHABLE' }),
    });
  });

  it('draws no notice for a run that reads no storefront', async () => {
    const { fixture } = await onDeza();
    const preset = fixture.componentInstance.presets()[0];

    expect(
      fixture.componentInstance.probeNoticeOf({
        ...preset,
        input: { ...preset.input, mode: 'FILE_IMPORT' },
      })
    ).toBe(null);
  });

  const question = (
    fixture: ComponentFixture<PresetsPanel>
  ): HTMLElement | null =>
    fixture.nativeElement.querySelector('[data-start-question]');

  it('asks before it starts, with Start enabled and the notice shown', async () => {
    const { fixture, recorded } = await onDeza();
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('[data-start]');

    expect(
      fixture.nativeElement.querySelector('[data-probe-notice]')
    ).not.toBeNull();
    expect(button.disabled).toBe(false);

    button.click();
    await settle(fixture);

    expect(recorded.started).toEqual([]);
    const dialog = question(fixture);
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.querySelector('h2')?.textContent?.trim()).toBe(
      'harvest.probeNotice.question.heading'
    );
    expect(dialog?.querySelector('p')?.textContent?.trim()).toBe(
      'harvest.probeNotice.text'
    );
    expect(fixture.componentInstance.pendingStart()?.message.args).toEqual(
      expect.objectContaining({ chain: DEZA, sentence: expect.any(String) })
    );
    // The keyboard is on Cancel, and Tab reaches "Start anyway".
    expect(document.activeElement).toBe(
      dialog?.querySelector('[data-dismiss]')
    );
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    );
    expect(document.activeElement).toBe(
      dialog?.querySelector('[data-confirm]')
    );
    expect(recorded.started).toEqual([]);
  });

  it('starts once when "Start anyway" is pressed twice before the dialog goes', async () => {
    const { fixture, recorded } = await onDeza();
    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);

    const confirm: HTMLButtonElement | null =
      question(fixture)?.querySelector('[data-confirm]') ?? null;
    confirm?.click();
    confirm?.click();
    await settle(fixture);

    expect(recorded.started).toEqual([DEZA_CATALOG_PRESET]);
  });

  it('starts at one press when the probe read failed', async () => {
    const failed = jest
      .spyOn(HarvestMemory.prototype, 'listProbes')
      .mockRejectedValue(new Error('the probe route did not answer'));
    const { fixture, recorded } = await onDeza();
    failed.mockRestore();

    expect(fixture.nativeElement.querySelector('[data-probe-notice]')).toBe(
      null
    );
    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);

    expect(question(fixture)).toBe(null);
    expect(recorded.started).toEqual([DEZA_CATALOG_PRESET]);
  });

  it('starts at one press when the probe read and the source read failed', async () => {
    const probes = jest
      .spyOn(HarvestMemory.prototype, 'listProbes')
      .mockRejectedValue(new Error('the probe route did not answer'));
    const source = jest
      .spyOn(HarvestMemory.prototype, 'readSource')
      .mockRejectedValue(new Error('the source route did not answer'));
    const { fixture, recorded } = await onDeza();
    probes.mockRestore();
    source.mockRestore();

    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);

    expect(question(fixture)).toBe(null);
    expect(recorded.started).toEqual([DEZA_CATALOG_PRESET]);
  });

  it('draws the refusal of a start made anyway on the row, with no question left open', async () => {
    const refused = jest
      .spyOn(HarvestMemory.prototype, 'startPreset')
      .mockRejectedValue(
        new GatewayError({
          correlationId: 'ref-1',
          code: 'conflict',
          status: 409,
        })
      );
    const { fixture, recorded } = await onDeza();
    const page = fixture.componentInstance;
    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);

    (
      question(fixture)?.querySelector('[data-confirm]') as HTMLButtonElement
    ).click();
    await settle(fixture);
    refused.mockRestore();

    expect(recorded.started).toEqual([DEZA_CATALOG_PRESET]);
    expect(page.refusalOf(DEZA_CATALOG_PRESET)?.key).toBe(
      'harvest.presets.alreadyRunning'
    );
    expect(text(fixture)).toContain('harvest.presets.alreadyRunning');
    expect(question(fixture)).toBe(null);
    expect(page.pendingStart()).toBe(null);
    expect(page.startingId()).toBe(null);
    // The warning is still on the row, and Start is free to press again.
    expect(
      fixture.nativeElement.querySelector('[data-probe-notice]')
    ).not.toBeNull();
    expect(
      (fixture.nativeElement.querySelector('[data-start]') as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it('closes the question when another chain is chosen', async () => {
    const { fixture, recorded } = await onDeza();
    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);
    expect(question(fixture)).not.toBeNull();

    fixture.componentInstance.chooseChain(MERCADONA);
    await settle(fixture);

    expect(fixture.componentInstance.pendingStart()).toBe(null);
    expect(question(fixture)).toBe(null);
    expect(recorded.started).toEqual([]);
  });

  it('starts the preset once on "Start anyway", as one press did before', async () => {
    const { fixture, recorded } = await onDeza();
    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);

    const confirm: HTMLButtonElement | null =
      question(fixture)?.querySelector('[data-confirm]') ?? null;
    expect(confirm?.textContent?.trim()).toBe(
      'harvest.probeNotice.question.confirm'
    );
    confirm?.click();
    await settle(fixture);

    expect(recorded.started).toEqual([DEZA_CATALOG_PRESET]);
    expect(question(fixture)).toBe(null);
  });

  it('starts nothing on Cancel or Escape, and puts the keyboard back on Start', async () => {
    const { fixture, recorded } = await onDeza();
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('[data-start]');

    button.click();
    await settle(fixture);
    const cancel: HTMLButtonElement | null =
      question(fixture)?.querySelector('[data-dismiss]') ?? null;
    expect(cancel?.textContent?.trim()).toBe('resource.action.cancel');
    cancel?.click();
    await settle(fixture);

    expect(question(fixture)).toBe(null);
    expect(document.activeElement).toBe(button);

    button.click();
    await settle(fixture);
    question(fixture)?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' })
    );
    await settle(fixture);

    expect(question(fixture)).toBe(null);
    expect(document.activeElement).toBe(button);
    expect(recorded.started).toEqual([]);
  });

  it('starts at one press for a chain whose newest probe passed', async () => {
    const { fixture, recorded } = await render();

    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);

    expect(question(fixture)).toBe(null);
    expect(recorded.started).toHaveLength(1);
  });

  it('starts at one press for a chain with no probe', async () => {
    const noProbes = jest
      .spyOn(HarvestMemory.prototype, 'listProbes')
      .mockResolvedValue({ items: [], nextCursor: null });
    const { fixture, recorded } = await onDeza();
    noProbes.mockRestore();

    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);

    expect(question(fixture)).toBe(null);
    expect(recorded.started).toEqual([DEZA_CATALOG_PRESET]);
  });

  it('starts at one press a store discovery over OpenStreetMap', async () => {
    const memory = new HarvestMemory();
    const deza = await memory.readSource(DEZA);
    const osm = jest
      .spyOn(HarvestMemory.prototype, 'readSource')
      .mockResolvedValue({ ...deza, adapterKey: 'osm-places' });
    const { fixture, recorded } = await onDeza();
    osm.mockRestore();
    await recorded.memory.createPreset(DEZA, 'Shops', {
      mode: 'STORE_DISCOVERY',
    });
    await fixture.componentInstance.load();
    await settle(fixture);
    const shops = fixture.componentInstance
      .presets()
      .find((preset) => preset.name === 'Shops');
    expect(shops).toBeDefined();
    if (shops === undefined) {
      return;
    }

    fixture.componentInstance.requestStart(shops);
    await settle(fixture);

    expect(question(fixture)).toBe(null);
    expect(recorded.started).toEqual([shops.id]);
  });

  it('starts at one press while the probe read is still in flight', async () => {
    let answer: (page: { items: never[]; nextCursor: null }) => void = () =>
      undefined;
    const pending = jest
      .spyOn(HarvestMemory.prototype, 'listProbes')
      .mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        })
      );
    const { fixture, recorded } = await onDeza();

    fixture.nativeElement.querySelector('[data-start]').click();
    await settle(fixture);

    expect(question(fixture)).toBe(null);
    expect(recorded.started).toEqual([DEZA_CATALOG_PRESET]);
    answer({ items: [], nextCursor: null });
    pending.mockRestore();
  });

  it('draws no notice for a chain whose newest probe passed', async () => {
    const { fixture, recorded } = await render();

    expect(fixture.componentInstance.presets()).toHaveLength(1);
    expect(recorded.probeReads).toEqual([MERCADONA]);
    expect(fixture.nativeElement.querySelector('[data-probe-notice]')).toBe(
      null
    );
  });
});
