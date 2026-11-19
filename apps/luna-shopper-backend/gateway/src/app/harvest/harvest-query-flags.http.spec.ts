import { Test } from '@nestjs/testing';
import {
  HARVEST_PATTERNS,
  POSTAL_CODE_DISCOVERY_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminHarvestPostalCodesController,
  AdminHarvestRunsController,
} from './harvest.controller';

/**
 * The boolean query filters of the harvest routes, through the real pipe.
 *
 * The pipe converts implicitly, and its conversion of a boolean is
 * `Boolean(value)`: the text `false` reaches a transform as `true`. A flag that
 * is not read from the raw text thus answers the opposite question for
 * `?flag=false`. Over HTTP, because the conversion happens in the pipe and a
 * handler call never meets it.
 */

interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

async function boot() {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [
        AdminHarvestRunsController,
        AdminHarvestPostalCodesController,
      ],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (
              subject: unknown,
              payload: Record<string, unknown>
            ) => {
              sent.push({ subject, payload });
              return { items: [], nextCursor: null };
            },
          },
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest()['user'] = {
            adminId: 'admin-1',
            token: 'token',
          };
          return true;
        },
      })
      .compile()
  ).createNestApplication();

  nest.useGlobalPipes(createValidationPipe());
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

describe.each([
  ['GET /v1/admin/harvest/runs', 'runs', 'reverted', HARVEST_PATTERNS.runList],
  [
    'GET /v1/admin/harvest/postal-codes',
    'postal-codes',
    'dismissed',
    POSTAL_CODE_DISCOVERY_PATTERNS.list,
  ],
])('%s reads its flag from the text sent', (_route, path, flag, subject) => {
  let context: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await context?.nest.close();
    context = undefined;
  });

  it.each([
    ['true', true],
    ['false', false],
    ['', true],
  ])(`reads ${flag}=%p as %p`, async (spelled, read) => {
    context = await boot();

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/${path}?${flag}=${spelled}`
    );

    expect(response.status).toBe(200);
    expect(context.sent[0].subject).toBe(subject);
    expect(context.sent[0].payload[flag]).toBe(read);
  });

  it(`leaves ${flag} out when the query does not name it`, async () => {
    context = await boot();

    const response = await fetch(`${context.origin}/v1/admin/harvest/${path}`);

    expect(response.status).toBe(200);
    expect(context.sent[0].payload[flag]).toBeUndefined();
  });

  it(`refuses a ${flag} that is neither true nor false`, async () => {
    context = await boot();

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/${path}?${flag}=no`
    );

    expect(response.status).toBe(400);
    expect(context.sent).toHaveLength(0);
  });
});
