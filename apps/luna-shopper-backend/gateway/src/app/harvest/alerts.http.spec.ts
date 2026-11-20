import { Test } from '@nestjs/testing';
import {
  createValidationPipe,
  enableApiVersioning,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminHarvestAlertsController } from './harvest.controller';

/**
 * The test alert route over real HTTP (plan 0218, section 7).
 *
 * It reaches `harvestAlert.sendTest` with the operator's credential and
 * nothing else, and answers 201 with the harvester's body, as every POST in
 * this gateway does.
 */

const VIEW = {
  id: '02180218-0000-4000-8000-000000000001',
  queuedAt: '2026-11-05T10:00:00.000Z',
  recipientConfigured: true,
  smtpConfigured: true,
};

async function boot() {
  const send = jest.fn(async () => VIEW);
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminHarvestAlertsController],
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

describe('the test alert route', () => {
  let context: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    context = await boot();
  });

  afterAll(async () => {
    await context.nest.close();
  });

  it('reaches harvestAlert.sendTest with the credential and answers 201', async () => {
    const response = await fetch(
      `${context.origin}/v1/admin/harvest/alerts/test`,
      { method: 'POST', headers: { 'content-type': 'application/json' } }
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(VIEW);
    expect(context.send).toHaveBeenCalledTimes(1);
    expect(context.send).toHaveBeenCalledWith('harvestAlert.sendTest', {
      userId: 'operator-1',
      adminToken: 'the-operators-own-token',
    });
  });
});
