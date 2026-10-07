import { Test } from '@nestjs/testing';
import { LIST_PATTERNS } from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NatsClient } from '../messaging/nats-client';
import { ItemHistoryController } from './list.controller';

/**
 * `GET /v1/items/:id/list-lines` over real HTTP (plan 0196, section 3).
 *
 * Two things only a real request shows. The route sits beside
 * `GET /v1/items/:id/lists` on one controller, and a path that one of them
 * swallowed would answer with the other's shape. And an id that is not a
 * uuid has to be a 400 at the gateway, before core is asked anything.
 */

interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

const ITEM = 'cf000000-0000-4000-a000-0000000000aa';

async function boot() {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [ItemHistoryController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (
              subject: unknown,
              payload: Record<string, unknown>
            ) => {
              sent.push({ subject, payload });
              return { lists: [], hasMore: false };
            },
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): Record<string, unknown> };
        }) => {
          context.switchToHttp().getRequest()['user'] = { userId: 'user-1' };
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

describe('GET /v1/items/:id/list-lines', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot();
  });

  afterAll(async () => {
    await app.nest.close();
  });

  beforeEach(() => {
    app.sent.length = 0;
  });

  it('asks core for the caller and the product, and answers what core said', async () => {
    const response = await fetch(`${app.origin}/v1/items/${ITEM}/list-lines`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ lists: [], hasMore: false });
    expect(app.sent).toEqual([
      {
        subject: LIST_PATTERNS.linesHoldingItem,
        payload: { userId: 'user-1', itemId: ITEM },
      },
    ]);
  });

  it('refuses an id that is not a uuid, and asks core nothing', async () => {
    const response = await fetch(`${app.origin}/v1/items/milk/list-lines`);

    expect(response.status).toBe(400);
    expect(app.sent).toHaveLength(0);
  });

  it('leaves the route beside it as it was', async () => {
    const response = await fetch(`${app.origin}/v1/items/${ITEM}/lists`);

    expect(response.status).toBe(200);
    expect(app.sent.map((message) => message.subject)).toEqual([
      LIST_PATTERNS.holdingItem,
    ]);
  });
});
