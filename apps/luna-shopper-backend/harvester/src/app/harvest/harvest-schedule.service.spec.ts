import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestScheduleBlock,
} from '@portfolio/luna-shopper/contracts';
import {
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestRunPreset, HarvestSchedule } from '../entities';
import type { HarvestRunPresetStore } from './harvest-run-preset.store';
import type { HarvestRunService } from './harvest-run.service';
import type { HarvestRunStore, SourceRef } from './harvest-run.store';
import { HarvestScheduleService } from './harvest-schedule.service';
import type { HarvestScheduleStore } from './harvest-schedule.store';
import type { PlatformAdminService } from './platform-admin.service';

/**
 * Creating, changing and switching a schedule (plan 0206, sections 4 and 6).
 *
 * The clock is passed in. 2026-10-14 is a Wednesday, and Madrid is UTC+2.
 */

const ADMIN = 'owner-1';
const CHAIN = '02060206-0000-4000-a000-000000000001';
const PRESET = '02060206-0000-4000-a000-0000000000e1';
const SCHEDULE = '02060206-0000-4000-a000-0000000000f1';
const NOW = new Date('2026-10-14T05:00:00.000Z');

function schedule(over: Partial<HarvestSchedule> = {}): HarvestSchedule {
  return {
    id: SCHEDULE,
    presetId: PRESET,
    supermarketId: CHAIN,
    timeOfDay: '03:00',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    timezone: 'Europe/Madrid',
    enabled: true,
    nextRunAt: new Date('2026-10-15T01:00:00.000Z'),
    lastSlotAt: null,
    lastSlotAttempts: 0,
    lastRunId: null,
    lastOutcome: null,
    lastOutcomeAt: null,
    lastOutcomeNote: null,
    createdByUserId: ADMIN,
    updatedByUserId: ADMIN,
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    ...over,
  } as HarvestSchedule;
}

function build(
  overrides: {
    existing?: HarvestSchedule;
    config?: Partial<HarvesterConfig>;
    source?: Partial<SourceRef> | null;
  } = {}
) {
  const saved: HarvestSchedule[] = [];
  const store = {
    create: jest.fn((input: Partial<HarvestSchedule>) =>
      schedule({ ...input, id: SCHEDULE })
    ),
    save: jest.fn(async (row: HarvestSchedule) => {
      saved.push({ ...row });
      return row;
    }),
    load: jest.fn(async (id: string) => {
      if (id !== SCHEDULE) {
        throw new NotFoundException('Harvest schedule not found');
      }
      return { ...(overrides.existing ?? schedule()) };
    }),
    delete: jest.fn(async () => undefined),
  } as unknown as HarvestScheduleStore;

  const preset = {
    id: PRESET,
    supermarketId: CHAIN,
    name: 'Weekly Mercadona',
    input: { mode: HarvestRunMode.CATALOG_DISCOVERY },
  } as HarvestRunPreset;
  const presets = {
    load: jest.fn(async (id: string) => {
      if (id !== PRESET) {
        throw new NotFoundException('Harvest run preset not found');
      }
      return preset;
    }),
    repository: () => ({ findBy: jest.fn(async () => [preset]) }),
  } as unknown as HarvestRunPresetStore;

  const source: SourceRef | null =
    overrides.source === null
      ? null
      : {
          id: 'src-1',
          supermarketId: CHAIN,
          adapterKey: 'mercadona-api',
          enabled: true,
          consecutiveFailures: 0,
          ...overrides.source,
        };
  const runStore = {
    repository: () => ({ find: jest.fn(async () => []) }),
    sourcesFor: jest.fn(async () => (source ? [source] : [])),
  } as unknown as HarvestRunStore;

  const runs = {
    estimates: jest.fn(async (keys: unknown[]) =>
      keys.map(() => ({ seconds: 1200, basis: 'DEFAULT', samples: 0 }))
    ),
  } as unknown as HarvestRunService;

  const admin = {
    requireAdmin: async () => ADMIN,
  } as unknown as PlatformAdminService;
  const config = {
    getOrThrow: () => ({
      harvestEnabled: true,
      schedulerEnabled: true,
      ...overrides.config,
    }),
  } as unknown as ConfigService;

  const service = new HarvestScheduleService(
    store,
    presets,
    runStore,
    runs,
    admin,
    config,
    () => NOW
  );
  return { service, store, saved };
}

const create = {
  userId: ADMIN,
  presetId: PRESET,
  timeOfDay: '03:00',
  daysOfWeek: [5, 1],
  acknowledgedAutomaticFetch: true,
};

describe('HarvestScheduleService.create', () => {
  it('copies the chain from the preset and takes the next slot from now', async () => {
    const { service, saved } = build();

    const view = await service.create(create);

    // Friday 03:00 in Madrid is the first of Monday and Friday after a
    // Wednesday morning.
    expect(saved[0]).toMatchObject({
      presetId: PRESET,
      supermarketId: CHAIN,
      timeOfDay: '03:00',
      daysOfWeek: [1, 5],
      timezone: 'Europe/Madrid',
      enabled: true,
      nextRunAt: new Date('2026-10-16T01:00:00.000Z'),
      createdByUserId: ADMIN,
    });
    expect(view).toMatchObject({
      presetName: 'Weekly Mercadona',
      nextRunAt: '2026-10-16T01:00:00.000Z',
      blockedBy: null,
      estimate: { seconds: 1200, basis: 'DEFAULT', samples: 0 },
    });
  });

  it.each([
    ['absent', undefined],
    ['false', false],
    ['the string "true"', 'true'],
  ])(
    'refuses an acknowledgement that is %s, naming the field',
    async (_case, value) => {
      const { service, store } = build();

      const refusal = service.create({
        ...create,
        acknowledgedAutomaticFetch: value as boolean,
      });

      await expect(refusal).rejects.toBeInstanceOf(ValidationException);
      await expect(refusal).rejects.toMatchObject({
        details: { acknowledgedAutomaticFetch: 'must be true' },
      });
      expect(store.save).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['a time that is not HH:mm', { timeOfDay: '3:00' }, 'timeOfDay'],
    ['a time past the end of the day', { timeOfDay: '24:00' }, 'timeOfDay'],
    ['no day', { daysOfWeek: [] }, 'daysOfWeek'],
    ['a day twice', { daysOfWeek: [1, 1] }, 'daysOfWeek'],
    ['a day that is not 1 to 7', { daysOfWeek: [8] }, 'daysOfWeek'],
    ['an unknown timezone', { timezone: 'Europe/Atlantis' }, 'timezone'],
  ])('refuses %s', async (_case, patch, field) => {
    const { service, store } = build();

    const refusal = service.create({ ...create, ...patch });

    await expect(refusal).rejects.toBeInstanceOf(ValidationException);
    await expect(refusal).rejects.toMatchObject({
      details: { [field]: expect.any(String) },
    });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('answers 404 for a preset that does not exist', async () => {
    const { service } = build();
    await expect(
      service.create({ ...create, presetId: 'nope' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('HarvestScheduleService.update', () => {
  it('takes the next slot again from now for a schedule that is on', async () => {
    const { service, saved } = build();

    await service.update({
      userId: ADMIN,
      scheduleId: SCHEDULE,
      timeOfDay: '22:00',
    });

    // 22:00 in Madrid today has not come yet.
    expect(saved[0]).toMatchObject({
      timeOfDay: '22:00',
      nextRunAt: new Date('2026-10-14T20:00:00.000Z'),
    });
  });

  it('leaves a schedule that is off without a slot', async () => {
    const { service, saved } = build({
      existing: schedule({ enabled: false, nextRunAt: null }),
    });

    await service.update({
      userId: ADMIN,
      scheduleId: SCHEDULE,
      daysOfWeek: [6],
    });

    expect(saved[0]).toMatchObject({ daysOfWeek: [6], nextRunAt: null });
  });

  it('refuses a bad rule', async () => {
    const { service } = build();
    await expect(
      service.update({ userId: ADMIN, scheduleId: SCHEDULE, timeOfDay: '7' })
    ).rejects.toBeInstanceOf(ValidationException);
  });
});

describe('HarvestScheduleService.setEnabled', () => {
  it('switching off clears the slot and keeps the history', async () => {
    const lastSlotAt = new Date('2026-10-14T01:00:00.000Z');
    const { service, saved } = build({
      existing: schedule({ lastSlotAt, lastOutcome: null }),
    });

    await service.setEnabled({
      userId: ADMIN,
      scheduleId: SCHEDULE,
      enabled: false,
    });

    expect(saved[0]).toMatchObject({
      enabled: false,
      nextRunAt: null,
      lastSlotAt,
    });
  });

  it('switching on takes the next slot from now', async () => {
    const { service, saved } = build({
      existing: schedule({ enabled: false, nextRunAt: null }),
    });

    await service.setEnabled({
      userId: ADMIN,
      scheduleId: SCHEDULE,
      enabled: true,
      acknowledgedAutomaticFetch: true,
    });

    expect(saved[0]).toMatchObject({
      enabled: true,
      nextRunAt: new Date('2026-10-15T01:00:00.000Z'),
    });
  });

  it('refuses to switch on without the acknowledgement', async () => {
    const { service, store } = build({
      existing: schedule({ enabled: false, nextRunAt: null }),
    });

    await expect(
      service.setEnabled({
        userId: ADMIN,
        scheduleId: SCHEDULE,
        enabled: true,
      })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(store.save).not.toHaveBeenCalled();
  });
});

describe('HarvestScheduleService.delete', () => {
  it('deletes the row and answers its id', async () => {
    const { service, store } = build();
    await expect(
      service.delete({ userId: ADMIN, scheduleId: SCHEDULE })
    ).resolves.toEqual({ id: SCHEDULE });
    expect(store.delete).toHaveBeenCalledWith(SCHEDULE);
  });
});

describe('HarvestScheduleService, blockedBy (section 6)', () => {
  it.each<
    [string, Partial<HarvesterConfig>, Partial<SourceRef> | null, string | null]
  >([
    ['nothing', {}, {}, null],
    [
      'harvesting off, before everything',
      { harvestEnabled: false, schedulerEnabled: false },
      { enabled: false },
      HarvestScheduleBlock.HARVEST_DISABLED,
    ],
    [
      'the scheduler off',
      { schedulerEnabled: false },
      { enabled: false },
      HarvestScheduleBlock.SCHEDULER_DISABLED,
    ],
    [
      'the row off, before its failures',
      {},
      { enabled: false, consecutiveFailures: 4 },
      HarvestScheduleBlock.SOURCE_DISABLED,
    ],
    ['no row at all', {}, null, HarvestScheduleBlock.SOURCE_DISABLED],
    [
      'three failures',
      {},
      { consecutiveFailures: 3 },
      HarvestScheduleBlock.SOURCE_FAILING,
    ],
  ])('answers %s', async (_case, config, source, expected) => {
    const { service } = build({ config, source });

    const view = await service.get({ userId: ADMIN, scheduleId: SCHEDULE });

    expect(view.blockedBy).toBe(expected);
  });
});
