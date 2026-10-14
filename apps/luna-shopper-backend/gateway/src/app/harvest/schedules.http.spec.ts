import { Test } from '@nestjs/testing';
import { HarvestRunTrigger } from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  enableApiVersioning,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminHarvestRunsController,
  AdminHarvestSchedulesController,
} from './harvest.controller';

/**
 * The schedule routes over real HTTP (plan 0206, section 4).
 *
 * Each route reaches its subject with the operator's credential. The pipe is
 * the gateway's own, with its implicit conversion, because that conversion is
 * what reads the string "false" as true: `acknowledgedAutomaticFetch` is a
 * consent, so only a JSON boolean may pass it.
 */

const PRESET = '22222222-2222-4222-8222-222222222222';
const SCHEDULE = '44444444-4444-4444-8444-444444444444';
const CHAIN = '11111111-1111-4111-8111-111111111111';

async function boot() {
  const send = jest.fn(async () => ({}));
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminHarvestSchedulesController, AdminHarvestRunsController],
    providers: [{ provide: NatsClient, useValue: { send } }],
  })
    .overrideGuard(AdminJwtGuard)
    .useValue({
      canActivate: (context: {
        switchToHttp: () => { getRequest: () => Record<string, unknown> };
      }) => {
        context.switchToHttp().getRequest()['user'] = {
          adminId: 'operator-1',
          token: 'the-operators-own-token',
        };
        return true;
      },
    })
    .compile();

  const nest = moduleRef.createNestApplication();
  enableApiVersioning(nest);
  nest.useGlobalPipes(createValidationPipe());
  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, send, origin: `http://127.0.0.1:${port}` };
}

function call(
  origin: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('the schedule routes', () => {
  let context: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    context = await boot();
  });

  afterAll(async () => {
    await context.nest.close();
  });

  beforeEach(() => {
    context.send.mockClear();
  });

  function sent(): [string, Record<string, unknown>] {
    expect(context.send).toHaveBeenCalledTimes(1);
    return context.send.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
  }

  const create = {
    presetId: PRESET,
    timeOfDay: '03:00',
    daysOfWeek: [1, 4],
    timezone: 'Europe/Madrid',
    acknowledgedAutomaticFetch: true,
  };

  it('lists schedules by chain and preset', async () => {
    const response = await call(
      context.origin,
      'GET',
      `/v1/admin/harvest/schedules?supermarketId=${CHAIN}&presetId=${PRESET}&limit=10`
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestSchedule.list');
    expect(payload).toMatchObject({
      userId: 'operator-1',
      adminToken: 'the-operators-own-token',
      supermarketId: CHAIN,
      presetId: PRESET,
      limit: 10,
    });
  });

  it('creates a schedule with its rule and the acknowledgement', async () => {
    const response = await call(
      context.origin,
      'POST',
      '/v1/admin/harvest/schedules',
      create
    );

    expect(response.status).toBe(201);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestSchedule.create');
    expect(payload).toEqual({
      userId: 'operator-1',
      adminToken: 'the-operators-own-token',
      ...create,
    });
  });

  it.each([
    ['absent', undefined],
    ['the string "true"', 'true'],
    ['the string "false"', 'false'],
    ['a number', 1],
  ])(
    'refuses a create whose acknowledgement is %s, naming the field',
    async (_case, value) => {
      const response = await call(
        context.origin,
        'POST',
        '/v1/admin/harvest/schedules',
        { ...create, acknowledgedAutomaticFetch: value }
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain('acknowledgedAutomaticFetch');
      expect(context.send).not.toHaveBeenCalled();
    }
  );

  it('passes a JSON false to the harvester, which refuses it', async () => {
    const response = await call(
      context.origin,
      'POST',
      '/v1/admin/harvest/schedules',
      { ...create, acknowledgedAutomaticFetch: false }
    );

    expect(response.status).toBe(201);
    const [, payload] = sent();
    expect(payload['acknowledgedAutomaticFetch']).toBe(false);
  });

  it.each([
    ['a time that is not HH:mm', { timeOfDay: '3:00' }],
    ['a time past the end of the day', { timeOfDay: '24:00' }],
    ['no day', { daysOfWeek: [] }],
    ['a day that is not 1 to 7', { daysOfWeek: [0] }],
    ['a preset that is not a uuid', { presetId: 'weekly' }],
  ])('refuses %s', async (_case, patch) => {
    const response = await call(
      context.origin,
      'POST',
      '/v1/admin/harvest/schedules',
      { ...create, ...patch }
    );

    expect(response.status).toBe(400);
    expect(context.send).not.toHaveBeenCalled();
  });

  it('reads one schedule', async () => {
    const response = await call(
      context.origin,
      'GET',
      `/v1/admin/harvest/schedules/${SCHEDULE}`
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestSchedule.get');
    expect(payload).toMatchObject({ scheduleId: SCHEDULE });
  });

  it('changes when a schedule fires, and never its preset', async () => {
    const response = await call(
      context.origin,
      'PUT',
      `/v1/admin/harvest/schedules/${SCHEDULE}`,
      { timeOfDay: '22:30', daysOfWeek: [5] }
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestSchedule.update');
    expect(payload).toMatchObject({
      scheduleId: SCHEDULE,
      timeOfDay: '22:30',
      daysOfWeek: [5],
    });

    context.send.mockClear();
    const moved = await call(
      context.origin,
      'PUT',
      `/v1/admin/harvest/schedules/${SCHEDULE}`,
      { presetId: PRESET }
    );
    expect(moved.status).toBe(400);
    expect(context.send).not.toHaveBeenCalled();
  });

  it('switches a schedule on with the acknowledgement', async () => {
    const response = await call(
      context.origin,
      'PUT',
      `/v1/admin/harvest/schedules/${SCHEDULE}/enabled`,
      { enabled: true, acknowledgedAutomaticFetch: true }
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestSchedule.setEnabled');
    expect(payload).toMatchObject({
      scheduleId: SCHEDULE,
      enabled: true,
      acknowledgedAutomaticFetch: true,
    });
  });

  it('switches a schedule off with nothing else', async () => {
    const response = await call(
      context.origin,
      'PUT',
      `/v1/admin/harvest/schedules/${SCHEDULE}/enabled`,
      { enabled: false }
    );

    expect(response.status).toBe(200);
    const [, payload] = sent();
    expect(payload).toMatchObject({ enabled: false });
  });

  it.each([
    ['enabled', { enabled: 'false' }],
    [
      'acknowledgedAutomaticFetch',
      { enabled: true, acknowledgedAutomaticFetch: 'true' },
    ],
  ])(
    'refuses a string where the switch takes a boolean: %s',
    async (field, body) => {
      const response = await call(
        context.origin,
        'PUT',
        `/v1/admin/harvest/schedules/${SCHEDULE}/enabled`,
        body
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(field);
      expect(context.send).not.toHaveBeenCalled();
    }
  );

  it('deletes a schedule', async () => {
    const response = await call(
      context.origin,
      'DELETE',
      `/v1/admin/harvest/schedules/${SCHEDULE}`
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestSchedule.delete');
    expect(payload).toMatchObject({ scheduleId: SCHEDULE });
  });

  it('filters the runs list by schedule and by trigger', async () => {
    const response = await call(
      context.origin,
      'GET',
      `/v1/admin/harvest/runs?scheduleId=${SCHEDULE}&trigger=SCHEDULED`
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvest.run.list');
    expect(payload).toMatchObject({
      scheduleId: SCHEDULE,
      trigger: HarvestRunTrigger.SCHEDULED,
    });
  });
});
