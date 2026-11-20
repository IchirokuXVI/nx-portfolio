import { Test } from '@nestjs/testing';
import { SOURCE_PROBE_PATTERNS } from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  enableApiVersioning,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminHarvestProbesController,
  AdminHarvestSourcesController,
} from './harvest.controller';

/**
 * The probe routes over real HTTP (plan 0219, section 8): each route reaches
 * its subject with the operator's credential, and the start answers 201.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const PROBE = '55555555-5555-4555-8555-555555555555';

async function boot() {
  const send = jest.fn(async () => ({}));
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminHarvestProbesController, AdminHarvestSourcesController],
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

describe('the probe routes', () => {
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

  const credential = {
    userId: 'operator-1',
    adminToken: 'the-operators-own-token',
  };

  it('starts a probe with 201', async () => {
    const response = await fetch(
      `${context.origin}/v1/admin/harvest/sources/${CHAIN}/probes`,
      { method: 'POST' }
    );
    expect(response.status).toBe(201);
    expect(context.send).toHaveBeenCalledWith(SOURCE_PROBE_PATTERNS.start, {
      ...credential,
      supermarketId: CHAIN,
    });
  });

  it('lists the probes of a chain with a page', async () => {
    const response = await fetch(
      `${context.origin}/v1/admin/harvest/sources/${CHAIN}/probes?limit=5`
    );
    expect(response.status).toBe(200);
    expect(context.send).toHaveBeenCalledWith(SOURCE_PROBE_PATTERNS.list, {
      ...credential,
      supermarketId: CHAIN,
      cursor: undefined,
      limit: 5,
    });
  });

  it('refuses a limit above 100', async () => {
    const response = await fetch(
      `${context.origin}/v1/admin/harvest/sources/${CHAIN}/probes?limit=101`
    );
    expect(response.status).toBe(400);
    expect(context.send).not.toHaveBeenCalled();
  });

  it('reads one probe', async () => {
    const response = await fetch(
      `${context.origin}/v1/admin/harvest/probes/${PROBE}`
    );
    expect(response.status).toBe(200);
    expect(context.send).toHaveBeenCalledWith(SOURCE_PROBE_PATTERNS.get, {
      ...credential,
      probeId: PROBE,
    });
  });

  it('refuses an id that is not a uuid', async () => {
    const response = await fetch(
      `${context.origin}/v1/admin/harvest/probes/not-a-probe`
    );
    expect(response.status).toBe(400);
  });
});
