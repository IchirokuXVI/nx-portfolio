import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  HARVEST_SERVICE,
  HarvestMemory,
  MERCADONA_WEEKLY_PRESET,
  ServerReachability,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  provideSections,
  resourceFormBranch,
  ResourceReferences,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog, Viewport } from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import type { SchedulePage } from './schedule-page';
import { SCHEDULES } from './schedules';
import { SOURCES } from './sources';

/**
 * The page of a schedule (admin plan 0067, targets 3 to 8), drawn through the
 * router as the app mounts it. The translator double answers a key with the
 * key, so a case reads which sentence was drawn.
 */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const SCHEDULE = '77777777-7777-4777-8777-77777777aaaa';

type View = Wire.HarvestHarvestScheduleView;

function view(overrides: Partial<View> = {}): View {
  return {
    id: SCHEDULE,
    presetId: MERCADONA_WEEKLY_PRESET,
    presetName: 'Weekly warehouses',
    supermarketId: MERCADONA,
    timeOfDay: '06:00',
    daysOfWeek: [1, 3, 5],
    timezone: 'Europe/Madrid',
    enabled: true,
    nextRunAt: '2026-10-28T05:00:00.000Z',
    blockedBy: null,
    lastSlotAt: null,
    lastOutcome: null,
    lastOutcomeAt: null,
    lastOutcomeNote: null,
    lastRun: null,
    estimate: { seconds: 1200, basis: 'PRESET', samples: 6 },
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

@Component({ template: '' })
class ListStub {}

interface World {
  readonly shown?: View;
  readonly created: unknown[];
  readonly enabled: unknown[];
}

async function open(url: string, shown: View = view()) {
  const memory = new HarvestMemory();
  const world: World = { shown, created: [], enabled: [] };
  const service = {
    ...({} as HarvestServiceI),
    listPresets: (chain?: string, cursor?: string) =>
      memory.listPresets(chain, cursor),
    readSchedule: async () => world.shown,
    createSchedule: async (input: Wire.CreateHarvestScheduleDto) => {
      world.created.push(input);
      return view({ ...input, id: 'new-schedule' });
    },
    setScheduleEnabled: async (
      id: string,
      input: Wire.SetHarvestScheduleEnabledDto
    ) => {
      world.enabled.push({ id, input });
      return view({ enabled: input.enabled });
    },
  } as unknown as HarvestServiceI;

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      ServerReachability,
      DeploymentStore,
      {
        provide: DEPLOYMENT_SERVICE,
        useValue: {
          read: async () => ({
            deployment: 'development',
            devAutologin: false,
          }),
        },
      },
      { provide: HARVEST_SERVICE, useValue: service },
      {
        provide: ChainNames,
        useValue: {
          resolve: async () => undefined,
          known: (id: string) => (id === MERCADONA ? 'Mercadona' : null),
          nameOf: (id: string) => (id === MERCADONA ? 'Mercadona' : id),
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
          read: async () => ({ state: 'failed' }),
        },
      },
      {
        provide: Viewport,
        useValue: { compact: signal(false), split: signal(false) },
      },
      provideSections({
        key: 'harvest',
        label: '',
        segment: 'harvest',
        held: [SOURCES, SCHEDULES],
        heldUnder: 'setup',
      }),
      provideRouter([
        {
          path: 'harvest/setup',
          children: [
            { path: 'schedules', pathMatch: 'full', component: ListStub },
            resourceFormBranch(SCHEDULES),
          ],
        },
        { path: '**', component: ListStub },
      ]),
    ],
  }).compileComponents();

  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness);
  return { harness, world };
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
}

const text = (harness: RouterTestingHarness): string =>
  harness.routeNativeElement?.textContent ?? '';

const fact = (harness: RouterTestingHarness, name: string) =>
  harness.routeNativeElement?.querySelector<HTMLElement>(
    `[data-fact="${name}"]`
  ) ?? null;

describe('the page of a schedule, why it will not run', () => {
  const at = `/harvest/setup/schedules/${SCHEDULE}`;

  it('says nothing when nothing blocks it', async () => {
    const { harness } = await open(at);

    expect(fact(harness, 'blockedBy')).toBeNull();
  });

  it('says this cluster cannot start harvest runs', async () => {
    const { harness } = await open(at, view({ blockedBy: 'HARVEST_DISABLED' }));

    expect(fact(harness, 'blockedBy')?.textContent).toContain(
      'harvest.schedules.blocked.HARVEST_DISABLED'
    );
    expect(fact(harness, 'blockedBy')?.querySelector('a')).toBeNull();
  });

  it('says only production starts schedules', async () => {
    const { harness } = await open(
      at,
      view({ blockedBy: 'SCHEDULER_DISABLED' })
    );

    expect(fact(harness, 'blockedBy')?.textContent).toContain(
      'harvest.schedules.blocked.SCHEDULER_DISABLED'
    );
  });

  it('says the chain may not be fetched, with a link to its source', async () => {
    const { harness } = await open(at, view({ blockedBy: 'SOURCE_DISABLED' }));
    const link = fact(harness, 'blockedBy')?.querySelector('a');

    expect(fact(harness, 'blockedBy')?.textContent).toContain(
      'harvest.schedules.blocked.SOURCE_DISABLED'
    );
    expect(link?.getAttribute('href')).toBe(
      `/harvest/setup/sources/${MERCADONA}`
    );
  });

  it('says the chain keeps failing, with a link to the Runs tab', async () => {
    const { harness } = await open(at, view({ blockedBy: 'SOURCE_FAILING' }));
    const link = fact(harness, 'blockedBy')?.querySelector('a');

    expect(fact(harness, 'blockedBy')?.textContent).toContain(
      'harvest.schedules.blocked.SOURCE_FAILING'
    );
    expect(link?.getAttribute('href')).toBe(
      `/harvest/runs?chain=${MERCADONA}&preset=${MERCADONA_WEEKLY_PRESET}`
    );
  });

  it('says it on a schedule that is off too, which reads Off', async () => {
    const { harness } = await open(
      at,
      view({ enabled: false, nextRunAt: null, blockedBy: 'SOURCE_DISABLED' })
    );

    expect(fact(harness, 'blockedBy')).not.toBeNull();
    expect(fact(harness, 'nextRunAt')?.textContent).toContain(
      'harvest.schedules.next.none'
    );
    expect(text(harness)).toContain('harvest.schedules.state.off');
  });
});

describe('the page of a schedule, what the last slot did', () => {
  const at = `/harvest/setup/schedules/${SCHEDULE}`;
  const outcomes: Wire.EnumsHarvestScheduleOutcome[] = [
    'STARTED',
    'SKIPPED_LATE',
    'SKIPPED_FAILING',
    'REFUSED',
    'SKIPPED_BUSY',
  ];

  for (const outcome of outcomes) {
    it(`says ${outcome} in a phrase, with its note`, async () => {
      const { harness } = await open(
        at,
        view({
          lastSlotAt: '2026-10-26T05:00:00.000Z',
          lastOutcome: outcome,
          lastOutcomeAt: '2026-10-26T05:00:01.000Z',
          lastOutcomeNote: outcome === 'STARTED' ? null : 'run-in-the-way',
        })
      );
      const said = fact(harness, 'lastOutcome');

      expect(said?.textContent).toContain(
        `harvest.schedules.outcome.${outcome}`
      );
      expect(said?.querySelector('[data-note]')?.textContent ?? null).toBe(
        outcome === 'STARTED' ? null : 'run-in-the-way'
      );
    });
  }

  it('says no slot has come yet, and links the last run when there is one', async () => {
    const quiet = await open(at);
    expect(fact(quiet.harness, 'lastSlotAt')?.textContent).toContain(
      'harvest.schedules.outcome.none'
    );
    expect(fact(quiet.harness, 'lastOutcome')).toBeNull();

    const ran = await open(
      at,
      view({
        lastRun: {
          id: 'run-7',
          status: 'COMPLETED',
          requestedAt: '2026-10-26T05:00:02.000Z',
        },
      })
    );
    expect(
      fact(ran.harness, 'lastRun')?.querySelector('a')?.getAttribute('href')
    ).toBe('/harvest/runs/run-7');
  });
});

describe('the page of a schedule, the rows', () => {
  it('reads what runs and when, with the rules of a slot', async () => {
    const { harness } = await open(`/harvest/setup/schedules/${SCHEDULE}`);
    const page = harness.routeNativeElement as HTMLElement;

    expect(
      page.querySelector('[data-field="timeOfDay"]')?.textContent
    ).toContain('06:00');
    expect(
      page.querySelector('[data-field="daysOfWeek"]')?.textContent
    ).toContain('Mon, Wed, Fri');
    expect(page.querySelector('[data-rules]')?.textContent).toContain(
      'harvest.schedules.help.when'
    );
    expect(
      page.querySelector('[data-field="estimate"]')?.textContent
    ).toContain('harvest.schedules.estimate.PRESET');
  });

  it('turns the days on and off, sorted, once each, Monday first', async () => {
    const { harness } = await open(`/harvest/setup/schedules/new`);
    const page = harness.routeNativeElement as HTMLElement;
    const day = (n: number) =>
      page.querySelector<HTMLButtonElement>(`[data-day="${n}"]`);

    expect(
      [...page.querySelectorAll('[data-day]')].map((button) =>
        button.getAttribute('data-day')
      )
    ).toEqual(['1', '2', '3', '4', '5', '6', '7']);

    day(5)?.click();
    day(1)?.click();
    day(3)?.click();
    day(5)?.click();
    harness.detectChanges();

    expect(day(1)?.getAttribute('aria-pressed')).toBe('true');
    expect(day(5)?.getAttribute('aria-pressed')).toBe('false');
    const store = (
      harness.routeDebugElement?.componentInstance as {
        store: () => { draft: () => Record<string, unknown> };
      }
    ).store();
    expect(store.draft()['daysOfWeek']).toBe('1,3');
  });
});

describe('the page of a schedule, adding one', () => {
  async function fill(harness: RouterTestingHarness): Promise<HTMLElement> {
    const page = harness.routeNativeElement as HTMLElement;
    const preset = page.querySelector<HTMLSelectElement>('#schedule-preset');
    if (preset !== null) {
      preset.value = MERCADONA_WEEKLY_PRESET;
      preset.dispatchEvent(new Event('change'));
    }
    const time = page.querySelector<HTMLInputElement>('#schedule-time');
    if (time !== null) {
      time.value = '06:00';
      time.dispatchEvent(new Event('input'));
    }
    page.querySelector<HTMLButtonElement>('[data-day="2"]')?.click();
    harness.detectChanges();
    return page;
  }

  it('draws the box of the consent above Save, naming the chain', async () => {
    const { harness } = await open('/harvest/setup/schedules/new');
    const page = await fill(harness);
    await settle(harness);

    const consent = page.querySelector('[data-consent]');
    expect(consent?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(consent?.textContent).toContain('harvest.schedules.consent.text');
  });

  it('opens with the preset a link named', async () => {
    const { harness } = await open(
      `/harvest/setup/schedules/new?presetId=${MERCADONA_WEEKLY_PRESET}`
    );

    expect(
      (
        harness.routeNativeElement as HTMLElement
      ).querySelector<HTMLSelectElement>('#schedule-preset')?.value
    ).toBe(MERCADONA_WEEKLY_PRESET);
  });

  it('refuses Save without the tick, under the box, and sends nothing', async () => {
    const { harness, world } = await open('/harvest/setup/schedules/new');
    const page = await fill(harness);
    const view = harness.routeDebugElement?.query(By.css('lib-schedule-view'))
      ?.componentInstance as { save: () => Promise<void> };

    await view.save();
    await settle(harness);

    expect(world.created).toEqual([]);
    expect(
      page.querySelector('[data-consent] [data-error]')?.textContent
    ).toContain('harvest.schedules.consent.missing');
  });

  it('sends the consent with the save that was ticked, and opens the schedule', async () => {
    const { harness, world } = await open('/harvest/setup/schedules/new');
    const page = await fill(harness);
    const box = page.querySelector<HTMLInputElement>('#schedule-consent');
    if (box !== null) {
      box.checked = true;
      box.dispatchEvent(new Event('change'));
    }
    const view = harness.routeDebugElement?.query(By.css('lib-schedule-view'))
      ?.componentInstance as { save: () => Promise<void> };

    await view.save();
    await settle(harness);

    expect(world.created).toEqual([
      {
        presetId: MERCADONA_WEEKLY_PRESET,
        timeOfDay: '06:00',
        daysOfWeek: [2],
        acknowledgedAutomaticFetch: true,
      },
    ]);
    expect(TestBed.inject(Router).url).toBe(
      '/harvest/setup/schedules/new-schedule'
    );
  });
});

describe('the page of a schedule, turning it on', () => {
  it('asks the consent in its question, naming the chain, then sends it', async () => {
    const { harness, world } = await open(
      `/harvest/setup/schedules/${SCHEDULE}`,
      view({ enabled: false, nextRunAt: null })
    );
    const page = harness.routeDebugElement?.componentInstance as SchedulePage;

    // The More menu offers it, and not "Turn this schedule off".
    const offered = page.plainActions().map((action) => action.name);
    expect(offered).toEqual(['turn-on']);
    await page.run(page.plainActions()[0]);
    harness.detectChanges();

    const question = harness.routeDebugElement?.query(
      By.directive(ConfirmDialog)
    )?.componentInstance as ConfirmDialog;
    expect(question.bodyKey()).toBe('harvest.schedules.consent.text');
    expect(question.bodyArgs()).toEqual({
      name: 'Weekly warehouses',
      chain: 'Mercadona',
    });
    expect(world.enabled).toEqual([]);

    question.confirm.emit();
    await settle(harness);

    expect(world.enabled).toEqual([
      {
        id: SCHEDULE,
        input: { enabled: true, acknowledgedAutomaticFetch: true },
      },
    ]);
  });
});
