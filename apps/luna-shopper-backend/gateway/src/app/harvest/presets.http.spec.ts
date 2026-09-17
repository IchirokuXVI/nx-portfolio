import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  HarvestDetailFetch,
  HarvestRunMode,
  HarvestRunWrites,
} from '@portfolio/luna-shopper/contracts';
import { enableApiVersioning } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminHarvestPresetsController,
  AdminHarvestRunsController,
} from './harvest.controller';

/**
 * The preset routes over real HTTP (plan 0120, section 5).
 *
 * Each route reaches its subject with the operator's credential, and the body
 * of a preset is validated by the same DTO rules as a spawn, because its input
 * class is derived from the spawn body.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const PRESET = '22222222-2222-4222-8222-222222222222';
const SCOPE = '33333333-3333-4333-8333-333333333333';

async function boot() {
  const send = jest.fn(async () => ({}));
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminHarvestPresetsController, AdminHarvestRunsController],
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
  nest.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );
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

describe('the preset routes', () => {
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

  const input = {
    mode: HarvestRunMode.CATALOG_DISCOVERY,
    priceScopeIds: [SCOPE],
    scopeCopies: [{ from: SCOPE, to: [PRESET] }],
    writes: HarvestRunWrites.PRICES,
    details: HarvestDetailFetch.NEW,
  };

  it('lists a chain’s presets', async () => {
    const response = await call(
      context.origin,
      'GET',
      `/v1/admin/harvest/presets?supermarketId=${CHAIN}&limit=10`
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestPreset.list');
    expect(payload).toMatchObject({
      userId: 'operator-1',
      adminToken: 'the-operators-own-token',
      supermarketId: CHAIN,
      limit: 10,
    });
  });

  it('creates a preset with the chain, the name and the input', async () => {
    const response = await call(
      context.origin,
      'POST',
      '/v1/admin/harvest/presets',
      { supermarketId: CHAIN, name: 'Weekly Mercadona', input }
    );

    expect(response.status).toBe(201);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestPreset.create');
    expect(payload).toMatchObject({
      supermarketId: CHAIN,
      name: 'Weekly Mercadona',
      input,
    });
  });

  it('refuses an input that names the chain, which is the preset’s own field', async () => {
    const response = await call(
      context.origin,
      'POST',
      '/v1/admin/harvest/presets',
      {
        supermarketId: CHAIN,
        name: 'Weekly Mercadona',
        input: { ...input, supermarketId: CHAIN },
      }
    );

    expect(response.status).toBe(400);
    expect(context.send).not.toHaveBeenCalled();
  });

  it('refuses an input the spawn body would refuse', async () => {
    const response = await call(
      context.origin,
      'POST',
      '/v1/admin/harvest/presets',
      {
        supermarketId: CHAIN,
        name: 'Weekly Mercadona',
        input: { ...input, writes: 'EVERYTHING' },
      }
    );

    expect(response.status).toBe(400);
    expect(context.send).not.toHaveBeenCalled();
  });

  it('reads one preset', async () => {
    const response = await call(
      context.origin,
      'GET',
      `/v1/admin/harvest/presets/${PRESET}`
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestPreset.get');
    expect(payload).toMatchObject({ presetId: PRESET });
  });

  it('renames a preset and replaces its input', async () => {
    const response = await call(
      context.origin,
      'PUT',
      `/v1/admin/harvest/presets/${PRESET}`,
      { name: 'Monthly', input }
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestPreset.update');
    expect(payload).toMatchObject({ presetId: PRESET, name: 'Monthly', input });
  });

  it('deletes a preset', async () => {
    const response = await call(
      context.origin,
      'DELETE',
      `/v1/admin/harvest/presets/${PRESET}`
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvestPreset.delete');
    expect(payload).toMatchObject({ presetId: PRESET });
  });

  it('starts a run from a preset with nothing but its id', async () => {
    const response = await call(
      context.origin,
      'POST',
      `/v1/admin/harvest/presets/${PRESET}/runs`
    );

    expect(response.status).toBe(201);
    const [subject, payload] = sent();
    expect(subject).toBe('harvest.spawnFromPreset');
    expect(payload).toEqual({
      userId: 'operator-1',
      adminToken: 'the-operators-own-token',
      presetId: PRESET,
    });
  });

  it('filters the runs list by preset', async () => {
    const response = await call(
      context.origin,
      'GET',
      `/v1/admin/harvest/runs?presetId=${PRESET}`
    );

    expect(response.status).toBe(200);
    const [subject, payload] = sent();
    expect(subject).toBe('harvest.run.list');
    expect(payload).toMatchObject({ presetId: PRESET });
  });
});
