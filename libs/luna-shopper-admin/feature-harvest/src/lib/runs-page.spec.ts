import { provideLocationMocks } from '@angular/common/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DASHBOARD_SERVICE,
  DashboardStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  HARVEST_RUN_SEED,
  HARVEST_SERVICE,
  HarvestMemory,
  MERCADONA_WEEKLY_PRESET,
  RESOURCE_GATEWAYS,
  ServerReachability,
  type DashboardDocument,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  Deployment,
  HarvestRun,
} from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import {
  applyControlBase,
  controlBaseProperties,
} from './control-base.testing';
import { ImportHandoff } from './import-handoff';
import { PRESETS_CHAIN_KEY } from './presets-panel';
import { RunsPage } from './runs-page';

/**
 * The Runs tab (admin plan 0044, target 5): whether runs may start, the run in
 * progress, the presets, the file import and the earlier runs, on one page.
 *
 * The run form has a page of its own, and its cases are in
 * `new-run-page.spec.ts`. The presets panel has `presets-panel.spec.ts`. What
 * is here is the page around them: the state in the header, the two actions,
 * "Running now", the drop zone, and the list with its filters.
 */

const MERCADONA = '11111111-1111-4111-8111-111111111111';
const DEZA = '33333333-3333-4333-8333-333333333333';

/** What the directory calls each chain, whatever id it is asked about. */
const CHAINS: Readonly<Record<string, string>> = {
  [MERCADONA]: 'Mercadona',
  [DEZA]: 'Deza',
};

const RUNNING = HARVEST_RUN_SEED.find(
  (run) => run.status === 'RUNNING'
) as HarvestRun;

/** A run the harvester has never heard of, which it refuses to stop. */
const GHOST = 'run-nobody-has';

const drain = async () => {
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }
};

/** Where a link of the page lands. It draws nothing. */
@Component({ selector: 'lib-test-landing', template: '' })
class Landing {}

/** The harvester's block of the dashboard, with or without a run in flight. */
function harvestBlock(running: HarvestRun | null) {
  return {
    runs: { byStatus: [], inWindow: 0 },
    running,
    recent: [],
    queues: { entries: [], places: 0, shops: [], brands: 0 },
    sources: { total: 2, enabled: 0 },
  };
}

function dashboard(
  harvest: ReturnType<typeof harvestBlock> | null
): DashboardDocument {
  return {
    measuredAt: '2026-09-03T10:00:00.000Z',
    harvest,
  } as unknown as DashboardDocument;
}

/** What a spec changes about the world behind the page. */
interface RenderOptions {
  /** The presets read answers none, so every preset a run names is gone. */
  readonly presetsGone?: boolean;
  /** The runs read: the seed, none at all, or a refusal. */
  readonly runs?: 'seed' | 'none' | 'refused';
  readonly deployment?: Deployment;
  /** The run the dashboard names as in flight. The seed's own by default. */
  readonly running?: HarvestRun | null;
  /** The harvester did not answer the dashboard read. */
  readonly harvestDown?: boolean;
  readonly compact?: boolean;
  /** The address the page is opened at. */
  readonly url?: string;
}

async function render(options: RenderOptions = {}) {
  const memory = new HarvestMemory();
  const listed: unknown[] = [];
  const aborted: string[] = [];
  const reads = { dashboard: 0 };
  const compact = signal(options.compact ?? false);

  const service = {
    ...({} as HarvestServiceI),
    listRuns: async (query: never) => {
      listed.push(query);
      if (options.runs === 'refused') {
        throw new GatewayError({ code: '', status: 0, correlationId: '' });
      }
      return options.runs === 'none'
        ? { items: [], nextCursor: null }
        : memory.listRuns(query);
    },
    listPresets: async (supermarketId?: string, cursor?: string) =>
      options.presetsGone
        ? { items: [], nextCursor: null }
        : memory.listPresets(supermarketId, cursor),
    abortRun: async (id: string) => {
      aborted.push(id);
      if (id === GHOST) {
        throw new GatewayError({
          code: 'not_found',
          status: 404,
          correlationId: 'ref-1',
          detail: 'That run does not exist.',
        });
      }
      return memory.abortRun(id);
    },
  } as unknown as HarvestServiceI;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunsPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
      provideRouter([{ path: '**', component: Landing }]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      {
        provide: DASHBOARD_SERVICE,
        useValue: {
          read: async () => {
            reads.dashboard += 1;
            return dashboard(
              options.harvestDown === true
                ? null
                : harvestBlock(
                    options.running === undefined ? RUNNING : options.running
                  )
            );
          },
        },
      },
      {
        provide: Viewport,
        useValue: { compact, split: signal(!(options.compact ?? false)) },
      },
      {
        provide: RESOURCE_GATEWAYS,
        useValue: {
          for: () => ({ list: async () => ({ items: [], nextCursor: null }) }),
        },
      },
      {
        provide: ResourceReferences,
        useValue: {
          search: async () => [],
          resolve: async (_resource: string, id: string) =>
            CHAINS[id] === undefined ? null : { id, title: CHAINS[id] },
        },
      },
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: {
          read: async () => ({
            deployment: options.deployment ?? 'development',
            devAutologin: false,
          }),
        },
      },
      DeploymentStore,
    ],
  }).compileComponents();

  // The environment read decides whether a silence is expected, so it has
  // settled before the page is judged on the state it drew.
  await TestBed.inject(DeploymentStore).load();
  await TestBed.inject(Router).navigateByUrl(options.url ?? '/harvest/runs');

  const fixture = TestBed.createComponent(RunsPage);
  fixture.detectChanges();
  await drain();
  fixture.detectChanges();

  return {
    fixture: fixture as ComponentFixture<RunsPage>,
    page: fixture.componentInstance,
    listed,
    aborted,
    reads,
    memory,
  };
}

const text = (fixture: ComponentFixture<RunsPage>): string =>
  fixture.nativeElement.textContent;

const one = <T extends Element>(
  fixture: ComponentFixture<RunsPage>,
  selector: string
): T | null => fixture.nativeElement.querySelector(selector);

beforeEach(() => localStorage.removeItem(PRESETS_CHAIN_KEY));

afterEach(() => {
  // The page's status watches the dashboard, which holds a timer.
  TestBed.inject(DashboardStore).stop();
  localStorage.removeItem(PRESETS_CHAIN_KEY);
});

/**
 * "Runs may start" replaced a panel of two switches (admin plan 0044, target
 * 5). It says one thing: whether pressing Start will do anything.
 */
describe('the Runs tab, and whether runs may start', () => {
  /** The seed's runs started, so both switches are known to be on. */
  it('says runs may start once a run is known to have started', async () => {
    const { fixture, page } = await render();

    expect(page.state()).toBe('on');
    const chip = one(fixture, '[data-runs-state]');
    expect(chip?.textContent).toContain('harvest.runs.state.on');
    expect(chip?.classList.contains('on')).toBe(true);
  });

  /** Nothing ran and nothing was tried, so saying "may start" would be a guess. */
  it('says it is not known while nothing has run or been refused', async () => {
    const { fixture, page } = await render({ runs: 'none' });

    expect(page.state()).toBe('unknown');
    expect(one(fixture, '[data-runs-state]')?.textContent).toContain(
      'harvest.runs.state.unknown'
    );
  });

  it('says runs are off as soon as one switch is known to be off', async () => {
    const { fixture, page } = await render({
      runs: 'refused',
      deployment: 'production',
    });

    expect(page.state()).toBe('off');
    expect(one(fixture, '[data-runs-state]')?.textContent).toContain(
      'harvest.runs.state.off'
    );
  });

  it('explains the state behind an info button, and names Setup', async () => {
    const { fixture, page } = await render();

    expect(page.stateInfo.points).toEqual([
      'harvest.switch.info.both',
      'harvest.switch.info.chain',
    ]);
    expect(one(fixture, 'lib-harvest-header lib-info-button')).not.toBeNull();
    // The switch panel is gone, and so is its list of two switches.
    expect(one(fixture, 'lib-switch-panel')).toBeNull();
  });
});

/** "Import a file" and "New run": in the header, or in a bar on a phone. */
describe('the Runs tab, and its two actions', () => {
  it('draws both in the header on a wide screen', async () => {
    const { fixture } = await render();

    const links = [
      ...fixture.nativeElement.querySelectorAll('lib-harvest-header a.button'),
    ].map((link: HTMLAnchorElement) => link.getAttribute('href'));

    expect(links).toEqual(['/harvest/runs/import', '/harvest/runs/new']);
    expect(one(fixture, '[data-runs-bar]')).toBeNull();
  });

  it('draws both in a bar on a phone, and none in the header', async () => {
    const { fixture } = await render({ compact: true });

    const bar = one(fixture, '[data-runs-bar]');
    expect(bar).not.toBeNull();
    expect(
      [...(bar?.querySelectorAll('a') ?? [])].map((link) =>
        link.getAttribute('href')
      )
    ).toEqual(['/harvest/runs/import', '/harvest/runs/new']);
    expect(one(fixture, 'lib-harvest-header a.button')).toBeNull();
  });

  it('marks the new run action as the main one', async () => {
    const { fixture } = await render();

    expect(one(fixture, '[data-new-run]')?.classList.contains('primary')).toBe(
      true
    );
  });
});

/**
 * The harvester's dashboard is gone (target 7). Its notice that the harvester
 * did not answer stays at the top of this tab.
 */
describe('the Runs tab, when the harvester did not answer the dashboard', () => {
  it('says so at the top, and offers to read again', async () => {
    const { fixture, reads } = await render({ harvestDown: true });

    const notice = one(fixture, 'lib-block-notice');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('dashboard.down.harvest');

    const before = reads.dashboard;
    notice?.querySelector('button')?.click();
    await drain();

    expect(reads.dashboard).toBe(before + 1);
  });

  it('says nothing of the sort when it answered', async () => {
    const { fixture } = await render();

    expect(one(fixture, 'lib-block-notice')).toBeNull();
  });
});

/** The run in progress, which was the first block of the old dashboard. */
describe('the Runs tab, and the run in progress', () => {
  it('draws the run with its chain, its counters and a way to open it', async () => {
    const { fixture } = await render();

    const panel = one(fixture, '[data-running-now]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Mercadona');
    expect(panel?.textContent).toContain(`harvest.mode.${RUNNING.mode}`);
    expect(panel?.querySelector('lib-run-progress')).not.toBeNull();
    expect(panel?.querySelector('a.button')?.getAttribute('href')).toBe(
      `/harvest/runs/${RUNNING.id}`
    );
  });

  it('draws no such panel when nothing is running', async () => {
    const { fixture } = await render({ running: null });

    expect(one(fixture, '[data-running-now]')).toBeNull();
  });

  /** A run that finished between the query and the answer is not in progress. */
  it('draws no such panel for a run that has ended', async () => {
    const { fixture } = await render({
      running: { ...RUNNING, status: 'COMPLETED' },
    });

    expect(one(fixture, '[data-running-now]')).toBeNull();
  });

  /**
   * A stop is graceful: the run goes on flushing what it fetched. The panel
   * says so, and offers no second stop.
   */
  it('says a run is stopping once a stop was asked for', async () => {
    const { fixture } = await render({
      running: { ...RUNNING, abortRequestedAt: '2026-09-03T10:00:00.000Z' },
    });

    expect(one(fixture, '[data-stopping]')?.textContent).toContain(
      'harvest.run.aborting'
    );
    expect(one(fixture, '[data-stop-run]')).toBeNull();
  });

  it('says nothing about stopping while no stop was asked for', async () => {
    const { fixture } = await render();

    expect(one(fixture, '[data-stopping]')).toBeNull();
  });

  /** Stopping is asked about first, and nothing is sent until it is answered. */
  it('asks before it stops the run', async () => {
    const { fixture, page, aborted } = await render();

    one<HTMLButtonElement>(fixture, '[data-stop-run]')?.click();
    fixture.detectChanges();

    expect(page.stopping()?.id).toBe(RUNNING.id);
    expect(one(fixture, 'lib-confirm-dialog')).not.toBeNull();
    expect(aborted).toEqual([]);
  });

  it('stops the run, then reads the dashboard and the runs again', async () => {
    const { fixture, page, aborted, reads, listed } = await render();
    const dashboardReads = reads.dashboard;
    const runReads = listed.length;

    page.stopping.set(RUNNING);
    await page.stop(RUNNING);
    await drain();
    fixture.detectChanges();

    expect(aborted).toEqual([RUNNING.id]);
    expect(page.stopping()).toBeNull();
    expect(page.aborting()).toBe(false);
    expect(reads.dashboard).toBe(dashboardReads + 1);
    expect(listed.length).toBe(runReads + 1);
    expect(one(fixture, 'lib-confirm-dialog')).toBeNull();
  });

  it('says so when the run could not be stopped', async () => {
    const { fixture, page } = await render();
    const ghost = { ...RUNNING, id: GHOST };

    page.stopping.set(ghost);
    await page.stop(ghost);
    fixture.detectChanges();

    expect(page.abortFailure()).toBe('That run does not exist.');
    expect(page.stopping()).toBeNull();
    expect(text(fixture)).toContain('harvest.runs.running.stopFailed');
  });
});

/** The presets are a panel of this tab and no page of their own. */
describe('the Runs tab, and the presets', () => {
  it('holds the presets panel', async () => {
    const { fixture } = await render();

    expect(one(fixture, 'lib-presets-panel')).not.toBeNull();
  });

  it('marks the run a preset started, and reads the runs again', async () => {
    const { fixture, page, listed, reads } = await render();
    const runReads = listed.length;
    const dashboardReads = reads.dashboard;

    page.started({ ...RUNNING, id: 'run-catalog-completed' });
    await drain();
    fixture.detectChanges();

    expect(page.highlighted()).toBe('run-catalog-completed');
    expect(listed.length).toBe(runReads + 1);
    expect(reads.dashboard).toBe(dashboardReads + 1);
    expect(one(fixture, '.runs li.highlighted')).not.toBeNull();
  });
});

/**
 * The drop zone and "Choose a file" (target 5). This tab only carries the
 * file across: the import page reads it, previews it and sends it.
 */
describe('the Runs tab, and the file import', () => {
  const file = { name: 'leaflet.json' } as unknown as File;

  it('draws a place to drop a file and a button to choose one', async () => {
    const { fixture } = await render();

    expect(one(fixture, '[data-import]')).not.toBeNull();
    expect(one(fixture, '[data-choose-file]')).not.toBeNull();
    expect(text(fixture)).toContain('harvest.runs.import.drop');
    // The caution stays in sight, and not only behind the info button.
    expect(one(fixture, '[data-import] lib-caution-line')).not.toBeNull();
  });

  it('hands a chosen file to the import page and goes there', async () => {
    const { page } = await render();
    const input = { files: [file], value: 'C:\\fakepath\\leaflet.json' };

    page.chosen({ target: input } as unknown as Event);
    await drain();

    expect(TestBed.inject(Router).url).toBe('/harvest/runs/import');
    expect(TestBed.inject(ImportHandoff).take()).toBe(file);
    // Emptied, so that choosing the same file again is still a change.
    expect(input.value).toBe('');
  });

  it('hands a dropped file to the import page and goes there', async () => {
    const { page } = await render();
    let prevented = false;

    page.dragOver({
      preventDefault: () => (prevented = true),
    } as unknown as DragEvent);
    expect(prevented).toBe(true);
    expect(page.dragging()).toBe(true);

    page.drop({
      preventDefault: () => undefined,
      dataTransfer: { files: [file] },
    } as unknown as DragEvent);
    await drain();

    expect(page.dragging()).toBe(false);
    expect(TestBed.inject(Router).url).toBe('/harvest/runs/import');
    expect(TestBed.inject(ImportHandoff).take()).toBe(file);
  });

  it('goes nowhere when no file came with the event', async () => {
    const { page } = await render();

    page.chosen({ target: { files: [], value: '' } } as unknown as Event);
    await drain();

    expect(TestBed.inject(Router).url).toBe('/harvest/runs');
    expect(TestBed.inject(ImportHandoff).take()).toBeNull();
  });
});

/** Earlier runs: what each row says. */
describe('the runs list, and what a row says', () => {
  /** "Wrote" is what the run created plus what it updated (section 2). */
  it('counts what a run wrote as created plus updated', async () => {
    const { page } = await render();

    const row = page.rows().find((entry) => entry.id === RUNNING.id);
    expect(row?.wrote).toBe(RUNNING.created + RUNNING.updated);
    expect(row?.wrote).toBe(1452);
  });

  it('names the chain of a run, and none for a run over every chain', async () => {
    const { fixture, page } = await render();

    const rows = page.rows();
    expect(rows.find((row) => row.id === 'run-import-completed')?.chain).toBe(
      'Deza'
    );
    expect(rows.find((row) => row.id === 'run-store-aborted')?.chain).toBe('');
    expect(text(fixture)).toContain('harvest.runs.row.everyChain');
  });

  it('links a row to its run', async () => {
    const { fixture, page } = await render();

    expect(page.runLink('run-1')).toEqual(['/', 'harvest', 'runs', 'run-1']);
    expect(one(fixture, '.runs lib-run-row a')?.getAttribute('href')).toMatch(
      /^\/harvest\/runs\/run-/
    );
  });

  /** The run form and a preset both send the operator here with the run named. */
  it('marks the run the address names', async () => {
    const { fixture, page } = await render({
      url: '/harvest/runs?run=run-catalog-completed',
    });

    expect(page.highlighted()).toBe('run-catalog-completed');
    const marked = fixture.nativeElement.querySelectorAll(
      '.runs li.highlighted'
    );
    expect(marked.length).toBe(1);
    expect(marked[0].getAttribute('aria-current')).toBe('true');
  });

  it('says so when nothing has run', async () => {
    const { fixture } = await render({ runs: 'none', running: null });

    expect(text(fixture)).toContain('harvest.runs.empty');
  });
});

/**
 * The reverted filter, which had the chain field's defect.
 *
 * Its handler sat beside a banana box too, so the read went out with the choice
 * the operator had just moved away from and the list answered for the previous
 * one.
 */
describe('the runs list, and the filter over it', () => {
  it('reads with the filter just chosen', async () => {
    const { fixture, listed } = await render();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="reverted"]'
    );

    select.value = 'reverted';
    select.dispatchEvent(new Event('change'));
    await drain();

    expect(fixture.componentInstance.reverted()).toBe('reverted');
    expect(listed.at(-1)).toEqual({ limit: 20, reverted: true });
  });

  /** Admin plan 0034, section 4: one mode at a time, or all of them. */
  it('filters by mode, and sends none for any mode', async () => {
    const { fixture, listed } = await render();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="modeFilter"]'
    );

    const offered = [...select.querySelectorAll('option')].map(
      (option) => option.value
    );
    expect(offered).toEqual([
      '',
      'STORE_DISCOVERY',
      'CATALOG_DISCOVERY',
      'FILE_IMPORT',
    ]);

    select.value = 'STORE_DISCOVERY';
    select.dispatchEvent(new Event('change'));
    await drain();
    expect(listed.at(-1)).toEqual({ limit: 20, mode: 'STORE_DISCOVERY' });

    select.value = '';
    select.dispatchEvent(new Event('change'));
    await drain();
    expect(listed.at(-1)).toEqual({ limit: 20 });
  });
});

/**
 * The controls the list is filtered with (plan 0018, section 2).
 *
 * The rule is in `apps/luna-shopper-admin/src/styles.scss`, which a `TestBed`
 * does not load, so the spec puts it in front of the component the way a
 * browser puts it in front of an operator. It is read out of that file rather
 * than written here, since a copy would pass with the rule deleted.
 */
describe('the Runs tab, and its controls', () => {
  let remove: () => void;

  beforeEach(() => {
    remove = applyControlBase();
  });

  afterEach(() => remove());

  it('draws the reverted filter as a control and not as browser chrome', async () => {
    const { fixture } = await render();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="reverted"]'
    );

    expect(select).not.toBeNull();
    expect(getComputedStyle(select).getPropertyValue('min-block-size')).toBe(
      'var(--admin-control)'
    );
    expect(controlBaseProperties()).toContain('padding');
  });
});

/** The preset a run came from, and the filter by it (admin plan 0030, section 5). */
describe('the runs list, and the preset a run came from', () => {
  it('names the preset a run was started from', async () => {
    const { fixture } = await render();

    expect(fixture.componentInstance.presetOf('run-catalog-completed')).toEqual(
      { kind: 'named', name: 'Weekly warehouses' }
    );
    expect(text(fixture)).toContain('harvest.runs.row.preset');
    expect(fixture.componentInstance.presetOf('run-store-aborted')).toBeNull();
  });

  it('says a preset that no longer exists is deleted', async () => {
    // The run still names the seeded preset, which the chain no longer holds.
    const { fixture } = await render({ presetsGone: true });

    expect(fixture.componentInstance.presetOf('run-catalog-completed')).toEqual(
      { kind: 'deleted' }
    );
    expect(text(fixture)).toContain('harvest.runs.row.deletedPreset');
  });

  it('filters by preset', async () => {
    const { fixture, listed } = await render();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[name="preset"]'
    );

    select.value = MERCADONA_WEEKLY_PRESET;
    select.dispatchEvent(new Event('change'));
    await drain();

    expect(listed.at(-1)).toEqual({
      limit: 20,
      presetId: MERCADONA_WEEKLY_PRESET,
    });
  });
});
