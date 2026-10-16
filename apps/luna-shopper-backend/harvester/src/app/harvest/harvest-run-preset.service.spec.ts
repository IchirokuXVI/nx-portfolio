import {
  HarvestDetailFetch,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunWrites,
  type HarvestRunPresetInput,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type {
  HarvestRunPreset,
  HarvestSchedule,
  SupermarketSource,
} from '../entities';
import { HarvestRunPresetService } from './harvest-run-preset.service';
import type { HarvestRunPresetStore } from './harvest-run-preset.store';
import type {
  HarvestRunService,
  ValidatedRunRequest,
} from './harvest-run.service';
import type { HarvestScheduleStore } from './harvest-schedule.store';
import type { PlatformAdminService } from './platform-admin.service';
import type { SupermarketSourceService } from './supermarket-source.service';

const ADMIN = 'owner-1';
const SUPERMARKET = '5efa0000-0000-4000-a000-000000000001';
const SCOPE = '5efa0000-0000-4000-a000-0000000000ff';
const PRESET = '5efa0000-0000-4000-a000-0000000000e1';

const SOURCE = {
  id: 'src-1',
  supermarketId: SUPERMARKET,
  adapterKey: 'mercadona-api',
} as SupermarketSource;

/** What the run service resolves a Mercadona walk to, defaults included. */
const RESOLVED: HarvestRunPresetInput = {
  mode: HarvestRunMode.CATALOG_DISCOVERY,
  priceScopeIds: [SCOPE],
  writes: HarvestRunWrites.PRICES_AND_AVAILABILITY,
  details: HarvestDetailFetch.NEW,
};

function row(over: Partial<HarvestRunPreset> = {}): HarvestRunPreset {
  return {
    id: PRESET,
    supermarketId: SUPERMARKET,
    name: 'Weekly Mercadona',
    input: RESOLVED,
    createdByUserId: ADMIN,
    updatedByUserId: ADMIN,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    updatedAt: new Date('2026-09-01T09:00:00.000Z'),
    ...over,
  } as HarvestRunPreset;
}

function build(
  overrides: {
    validated?: Partial<ValidatedRunRequest>;
    refusal?: Error;
    existing?: HarvestRunPreset;
    /** The schedules that name the preset (plan 0206, section 2.1). */
    schedules?: HarvestSchedule[];
  } = {}
) {
  const admin = {
    requireAdmin: async (credential: { userId: string }) => {
      if (credential.userId !== ADMIN) {
        throw new ForbiddenException('nope');
      }
      return credential.userId;
    },
  } as unknown as PlatformAdminService;

  const runs = {
    validateRequest: jest.fn(async () => {
      if (overrides.refusal) {
        throw overrides.refusal;
      }
      return {
        supermarketId: SUPERMARKET,
        priceScopeId: null,
        documentSha256: null,
        payload: {},
        request: RESOLVED,
        ...overrides.validated,
      };
    }),
    estimates: jest.fn(async (keys: unknown[]) =>
      keys.map(() => ({ seconds: 1200, basis: 'DEFAULT', samples: 0 }))
    ),
  } as unknown as HarvestRunService;

  const sources = {
    findBySupermarket: jest.fn(async () => SOURCE),
  } as unknown as SupermarketSourceService;

  const store = {
    create: jest.fn(async (input) =>
      row({
        supermarketId: input.supermarketId,
        name: input.name,
        input: input.input,
        createdByUserId: input.userId,
        updatedByUserId: input.userId,
      })
    ),
    update: jest.fn(async (preset: HarvestRunPreset) => preset),
    load: jest.fn(async () => ({ ...(overrides.existing ?? row()) })),
    delete: jest.fn(async () => undefined),
    lastRuns: jest.fn(
      async () =>
        new Map([
          [
            PRESET,
            {
              id: 'run-9',
              status: HarvestRunStatus.COMPLETED,
              requestedAt: '2026-09-10T09:00:00.000Z',
            },
          ],
        ])
    ),
  } as unknown as HarvestRunPresetStore;

  const schedules = {
    findByPreset: jest.fn(async () => overrides.schedules ?? []),
  } as unknown as HarvestScheduleStore;

  const service = new HarvestRunPresetService(
    store,
    runs,
    sources,
    admin,
    schedules
  );
  return { service, store, runs, sources };
}

describe('HarvestRunPresetService.create (plan 0120)', () => {
  it('validates through the spawn validation and stores the resolved input', async () => {
    const { service, store, runs, sources } = build();

    const view = await service.create({
      userId: ADMIN,
      supermarketId: SUPERMARKET,
      name: '  Weekly Mercadona ',
      input: {
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        priceScopeIds: [SCOPE],
      },
    });

    expect(sources.findBySupermarket).toHaveBeenCalledWith(SUPERMARKET);
    expect(runs.validateRequest).toHaveBeenCalledWith(
      {
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        priceScopeIds: [SCOPE],
        supermarketId: SUPERMARKET,
      },
      SOURCE
    );
    expect(store.create).toHaveBeenCalledWith({
      supermarketId: SUPERMARKET,
      name: 'Weekly Mercadona',
      input: RESOLVED,
      userId: ADMIN,
    });
    expect(view).toEqual({
      id: PRESET,
      supermarketId: SUPERMARKET,
      name: 'Weekly Mercadona',
      input: RESOLVED,
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-01T09:00:00.000Z',
      lastRun: {
        id: 'run-9',
        status: HarvestRunStatus.COMPLETED,
        requestedAt: '2026-09-10T09:00:00.000Z',
      },
      estimate: { seconds: 1200, basis: 'DEFAULT', samples: 0 },
    });
  });

  it('saves nothing when the spawn validation refuses, with the same refusal', async () => {
    const refusal = new ValidationException(
      `The price scope ${SCOPE} does not belong to this chain`
    );
    const { service, store } = build({ refusal });

    await expect(
      service.create({
        userId: ADMIN,
        supermarketId: SUPERMARKET,
        name: 'Weekly',
        input: { mode: HarvestRunMode.CATALOG_DISCOVERY },
      })
    ).rejects.toBe(refusal);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('refuses a file import, which needs a document at the time', async () => {
    const { service, runs, store } = build();

    await expect(
      service.create({
        userId: ADMIN,
        supermarketId: SUPERMARKET,
        name: 'Leaflet',
        input: { mode: HarvestRunMode.FILE_IMPORT },
      })
    ).rejects.toThrow(/FILE_IMPORT cannot be saved/);
    expect(runs.validateRequest).not.toHaveBeenCalled();
    expect(store.create).not.toHaveBeenCalled();
  });

  it('refuses a store discovery around a postal code, which belongs to no chain', async () => {
    const { service, store } = build({ validated: { supermarketId: null } });

    await expect(
      service.create({
        userId: ADMIN,
        supermarketId: SUPERMARKET,
        name: 'Around 14013',
        input: { mode: HarvestRunMode.STORE_DISCOVERY, postalCode: '14013' },
      })
    ).rejects.toThrow(/belongs to no chain/);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('refuses an empty name and one longer than the column', async () => {
    const { service } = build();
    const create = (name: string) =>
      service.create({
        userId: ADMIN,
        supermarketId: SUPERMARKET,
        name,
        input: RESOLVED,
      });

    await expect(create('   ')).rejects.toBeInstanceOf(ValidationException);
    await expect(create('x'.repeat(81))).rejects.toThrow(/80 characters/);
  });

  it('is gated to the platform admin', async () => {
    const { service } = build();

    await expect(
      service.create({
        userId: 'someone',
        supermarketId: SUPERMARKET,
        name: 'Weekly',
        input: RESOLVED,
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('HarvestRunPresetService.update (plan 0120)', () => {
  it('replaces the input whole and validates it against the preset chain', async () => {
    const { service, store, runs } = build();

    await service.update({
      userId: ADMIN,
      presetId: PRESET,
      input: {
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        priceScopeIds: [SCOPE],
      },
    });

    expect(runs.validateRequest).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: SUPERMARKET }),
      SOURCE
    );
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ input: RESOLVED, updatedByUserId: ADMIN })
    );
  });

  it('keeps the chain when an input names another one', async () => {
    const { service, runs } = build();

    await service.update({
      userId: ADMIN,
      presetId: PRESET,
      input: {
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        supermarketId: 'another-chain',
      } as HarvestRunPresetInput,
    });

    expect(runs.validateRequest).toHaveBeenCalledWith(
      expect.objectContaining({ supermarketId: SUPERMARKET }),
      SOURCE
    );
  });

  it('renames without validating an input it was not given', async () => {
    const { service, store, runs } = build();

    const view = await service.update({
      userId: ADMIN,
      presetId: PRESET,
      name: 'Monthly Mercadona',
    });

    expect(runs.validateRequest).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Monthly Mercadona', input: RESOLVED })
    );
    expect(view.name).toBe('Monthly Mercadona');
  });

  it('saves nothing when the new input is refused', async () => {
    const { service, store } = build({
      refusal: new ValidationException('no warehouse'),
    });

    await expect(
      service.update({
        userId: ADMIN,
        presetId: PRESET,
        input: { mode: HarvestRunMode.CATALOG_DISCOVERY },
      })
    ).rejects.toThrow(/no warehouse/);
    expect(store.update).not.toHaveBeenCalled();
  });
});

describe('HarvestRunPresetService.delete (plan 0120)', () => {
  it('deletes the row and answers its id', async () => {
    const { service, store } = build();

    await expect(
      service.delete({ userId: ADMIN, presetId: PRESET })
    ).resolves.toEqual({ id: PRESET });
    expect(store.delete).toHaveBeenCalledWith(PRESET);
  });

  it('refuses while a schedule names the preset, and names the schedule (plan 0206)', async () => {
    const { service, store } = build({
      schedules: [{ id: 'schedule-1' } as HarvestSchedule],
    });

    const refusal = service.delete({ userId: ADMIN, presetId: PRESET });

    await expect(refusal).rejects.toBeInstanceOf(ConflictException);
    await expect(refusal).rejects.toThrow(/schedule-1/);
    expect(store.delete).not.toHaveBeenCalled();
  });
});

describe('HarvestRunPresetService views (plan 0206)', () => {
  it('carries the estimate of each preset, asked for by its chain and mode', async () => {
    const { service, runs } = build();

    const view = await service.get({ userId: ADMIN, presetId: PRESET });

    expect(view.estimate).toEqual({
      seconds: 1200,
      basis: 'DEFAULT',
      samples: 0,
    });
    expect(runs.estimates).toHaveBeenCalledWith([
      {
        presetId: PRESET,
        supermarketId: SUPERMARKET,
        mode: HarvestRunMode.CATALOG_DISCOVERY,
      },
    ]);
  });
});
