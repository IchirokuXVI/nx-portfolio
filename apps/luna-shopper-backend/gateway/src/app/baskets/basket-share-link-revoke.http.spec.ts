import { Test } from '@nestjs/testing';
import { BASKET_SHARING_PATTERNS } from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NatsClient } from '../messaging/nats-client';
import { BasketShareController } from './basket-sharing.controller';

/**
 * Revoking a share link with the "also remove the shoppers" tick off.
 *
 * velista always sends the tick, as `?revokeParticipants=false` or `=true`
 * (`BasketApi.revokeShareLink`). The pipe used to read the text `false` as
 * true, so a revoke that meant "stop it spreading" also evicted everybody who
 * had joined through the link. Core cascades exactly when the message says
 * `revokeParticipants: true`, so what is asserted here is the message.
 */

const BASKET = '0b000000-0000-4000-a000-000000000001';

async function boot() {
  const sent: { subject: unknown; payload: Record<string, unknown> }[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [BasketShareController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (
              subject: unknown,
              payload: Record<string, unknown>
            ) => {
              sent.push({ subject, payload });
              return { revoked: 1 };
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
          context.switchToHttp().getRequest()['user'] = { userId: 'owner-1' };
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

describe('DELETE /v1/baskets/:id/share-link', () => {
  let context: Awaited<ReturnType<typeof boot>>;

  beforeEach(async () => {
    context = await boot();
  });

  afterEach(async () => {
    await context.nest.close();
  });

  it('does not cascade to the participants for revokeParticipants=false', async () => {
    const response = await fetch(
      `${context.origin}/v1/baskets/${BASKET}/share-link?revokeParticipants=false`,
      { method: 'DELETE' }
    );

    expect(response.status).toBe(200);
    expect(context.sent).toEqual([
      {
        subject: BASKET_SHARING_PATTERNS.linkRevoke,
        payload: {
          userId: 'owner-1',
          basketId: BASKET,
          revokeParticipants: false,
        },
      },
    ]);
  });

  it('cascades for revokeParticipants=true', async () => {
    const response = await fetch(
      `${context.origin}/v1/baskets/${BASKET}/share-link?revokeParticipants=true`,
      { method: 'DELETE' }
    );

    expect(response.status).toBe(200);
    expect(context.sent[0].payload['revokeParticipants']).toBe(true);
  });

  it('refuses a tick that is neither true nor false, and revokes nothing', async () => {
    const response = await fetch(
      `${context.origin}/v1/baskets/${BASKET}/share-link?revokeParticipants=nope`,
      { method: 'DELETE' }
    );

    expect(response.status).toBe(400);
    expect(context.sent).toHaveLength(0);
  });
});
