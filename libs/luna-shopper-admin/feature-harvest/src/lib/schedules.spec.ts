import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  DEZA_CATALOG_PRESET,
  DEZA_NIGHTLY_SCHEDULE,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  MERCADONA_SUNDAY_SCHEDULE,
  MERCADONA_WEEKDAYS_SCHEDULE,
  MERCADONA_WEEKLY_PRESET,
  ServerReachability,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  isEditable,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { ChainNames } from './chain-names';
import { SCHEDULES } from './schedules';
import { SchedulesGateway, type Schedule } from './schedules-gateway';

/**
 * The schedules as a resource (admin plan 0067): what the descriptor claims,
 * and what its gateway sends to `HARVEST_SERVICE`. The harvester is the
 * in-memory one, with each write recorded on its way through.
 */
const MERCADONA = '11111111-1111-4111-8111-111111111111';

function setup() {
  const harvest = new HarvestMemory();
  const created: unknown[] = [];
  const enabled: unknown[] = [];
  const updated: unknown[] = [];
  const createSchedule = harvest.createSchedule.bind(harvest);
  const setScheduleEnabled = harvest.setScheduleEnabled.bind(harvest);
  const updateSchedule = harvest.updateSchedule.bind(harvest);
  harvest.createSchedule = (input) => {
    created.push(input);
    return createSchedule(input);
  };
  harvest.setScheduleEnabled = (id, input) => {
    enabled.push({ id, input });
    return setScheduleEnabled(id, input);
  };
  harvest.updateSchedule = (id, patch) => {
    updated.push({ id, patch });
    return updateSchedule(id, patch);
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RokuTranslatorTestingModule.forTesting()],
    providers: [
      ServerReachability,
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
      {
        provide: ChainNames,
        useValue: {
          resolve: async () => undefined,
          known: (id: string) => (id === MERCADONA ? 'Mercadona' : null),
          nameOf: (id: string) => id,
        },
      },
    ],
  });

  const gateway = TestBed.inject(SchedulesGateway);
  const actions = TestBed.runInInjectionContext(
    () => SCHEDULES.actions?.named?.() ?? []
  );
  return { harvest, gateway, actions, created, enabled, updated };
}

const NEW = {
  presetId: MERCADONA_WEEKLY_PRESET,
  timeOfDay: '06:00',
  daysOfWeek: '5,1,3',
  timezone: '',
};

describe('SCHEDULES, adding one asks for the consent', () => {
  it('refuses a save with no tick under the box, and sends nothing', async () => {
    const { gateway, created } = setup();

    const refusal = await gateway
      .create({ ...NEW, acknowledgedAutomaticFetch: false })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(GatewayError);
    expect((refusal as GatewayError).fieldErrors).toEqual({
      acknowledgedAutomaticFetch: ['harvest.schedules.consent.missing'],
    });
    expect(created).toEqual([]);
  });

  it('refuses a save where the box was never drawn', async () => {
    const { gateway, created } = setup();

    await expect(gateway.create({ ...NEW })).rejects.toBeInstanceOf(
      GatewayError
    );
    expect(created).toEqual([]);
  });

  it('sends the JSON true with the save that was ticked, and the days sorted', async () => {
    const { gateway, created } = setup();

    const saved = await gateway.create({
      ...NEW,
      acknowledgedAutomaticFetch: true,
    });

    expect(created).toEqual([
      {
        presetId: MERCADONA_WEEKLY_PRESET,
        timeOfDay: '06:00',
        daysOfWeek: [1, 3, 5],
        acknowledgedAutomaticFetch: true,
      },
    ]);
    // No timezone was chosen: the harvester takes Europe/Madrid, which is
    // what the form showed.
    expect(saved).toMatchObject({
      timezone: 'Europe/Madrid',
      chainName: 'Mercadona',
      cadence: 'harvest.schedules.cadence.days',
    });
    expect(saved).not.toHaveProperty('acknowledgedAutomaticFetch');
  });

  it('sends a timezone that was chosen', async () => {
    const { gateway, created } = setup();

    await gateway.create({
      ...NEW,
      timezone: 'Atlantic/Canary',
      acknowledgedAutomaticFetch: true,
    });

    expect(created).toEqual([
      expect.objectContaining({ timezone: 'Atlantic/Canary' }),
    ]);
  });
});

describe('SCHEDULES, changing one', () => {
  it('sends only what changed, the days sorted, and never the consent', async () => {
    const { gateway, updated } = setup();

    await gateway.update(MERCADONA_WEEKDAYS_SCHEDULE, {
      daysOfWeek: '7,2',
    });

    expect(updated).toEqual([
      { id: MERCADONA_WEEKDAYS_SCHEDULE, patch: { daysOfWeek: [2, 7] } },
    ]);
  });

  it('cannot change the preset, the chain or whether it is on from the form', () => {
    const editable = SCHEDULES.fields
      .filter((field) => isEditable(field, 'edit'))
      .map((field) => field.name);

    expect(editable).toEqual(['timeOfDay', 'daysOfWeek', 'timezone']);
  });

  it('asks for the consent on a new schedule only', () => {
    const consent = SCHEDULES.fields.find(
      (field) => field.name === 'acknowledgedAutomaticFetch'
    );

    expect(consent?.editable).toBe('create');
  });
});

describe('SCHEDULES, turning one on and off', () => {
  const action = (name: string) =>
    setup().actions.find((candidate) => candidate.name === name);

  it('offers on to a schedule that is off, and off to one that is on', async () => {
    const { actions, gateway } = setup();
    const on = await gateway.read(MERCADONA_WEEKDAYS_SCHEDULE);
    const off = await gateway.read(MERCADONA_SUNDAY_SCHEDULE);
    const offered = (row: Schedule) =>
      actions
        .filter((candidate) => candidate.available?.(row) !== false)
        .map((candidate) => candidate.name);

    expect(offered(on as unknown as Schedule)).toEqual([
      'turn-off',
      'delete-schedule',
    ]);
    expect(offered(off as unknown as Schedule)).toEqual([
      'turn-on',
      'delete-schedule',
    ]);
  });

  it('asks the consent before turning one on, on the record page alone', () => {
    const on = action('turn-on');

    expect(on?.confirm?.body).toBe('harvest.schedules.consent.text');
    expect(on?.recordOnly).toBe(true);
    expect(on?.danger).toBeUndefined();
  });

  it('sends the consent with the turn on that the question confirmed', async () => {
    const { actions, gateway, enabled } = setup();
    const row = await gateway.read(MERCADONA_SUNDAY_SCHEDULE);

    await actions
      .find((candidate) => candidate.name === 'turn-on')
      ?.run(row as unknown as ResourceRow);

    expect(enabled).toEqual([
      {
        id: MERCADONA_SUNDAY_SCHEDULE,
        input: { enabled: true, acknowledgedAutomaticFetch: true },
      },
    ]);
  });

  it('turns one off with no consent and no question', async () => {
    const { actions, gateway, enabled } = setup();
    const row = await gateway.read(MERCADONA_WEEKDAYS_SCHEDULE);
    const off = actions.find((candidate) => candidate.name === 'turn-off');

    await off?.run(row as unknown as ResourceRow);

    expect(off?.confirm).toBeUndefined();
    expect(enabled).toEqual([
      { id: MERCADONA_WEEKDAYS_SCHEDULE, input: { enabled: false } },
    ]);
  });

  it('deletes after a question, in red, and goes to the list', () => {
    const remove = action('delete-schedule');

    expect(remove?.danger).toBe(true);
    expect(remove?.after).toBe('leave');
    expect(remove?.confirm).toBeDefined();
  });
});

describe('SCHEDULES, the list', () => {
  it('says On, Off, or Will not run in the waiting tone', async () => {
    const { gateway } = setup();
    const states = TestBed.runInInjectionContext(
      () => SCHEDULES.rowStates?.() ?? (() => [])
    );
    const page = await gateway.list({});
    const byId = new Map(page.items.map((row) => [row.id, row]));
    const stateOf = (id: string) =>
      states(byId.get(id) as unknown as ResourceRow);

    expect(stateOf(MERCADONA_WEEKDAYS_SCHEDULE)).toEqual([
      { label: 'harvest.schedules.state.on', tone: 'good' },
    ]);
    expect(stateOf(MERCADONA_SUNDAY_SCHEDULE)).toEqual([
      { label: 'harvest.schedules.state.off', tone: 'neutral' },
    ]);
    expect(stateOf(DEZA_NIGHTLY_SCHEDULE)).toEqual([
      { label: 'harvest.schedules.state.blocked', tone: 'waiting' },
    ]);
  });

  it('narrows the list by chain', async () => {
    const { gateway } = setup();

    const page = await gateway.list({
      filters: { supermarketId: MERCADONA },
    });

    expect(page.items.map((row) => row.presetId)).toEqual([
      MERCADONA_WEEKLY_PRESET,
      MERCADONA_WEEKLY_PRESET,
    ]);
    expect(page.items.map((row) => row.presetId)).not.toContain(
      DEZA_CATALOG_PRESET
    );
  });

  it('shows the preset, the chain, when it runs and the next run', () => {
    expect(SCHEDULES.list.columns).toEqual([
      'presetName',
      'supermarketId',
      'cadence',
      'nextRunAt',
    ]);
    expect(
      SCHEDULES.filters?.map((filter) => [filter.kind, filter.param])
    ).toEqual([['reference', 'supermarketId']]);
  });
});
