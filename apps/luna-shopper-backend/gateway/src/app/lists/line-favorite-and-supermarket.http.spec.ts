import { Test } from '@nestjs/testing';
import { LINE_PATTERNS } from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettlePriceService } from '../baskets/settle-price.service';
import { NatsClient } from '../messaging/nats-client';
import { CommentTranscriptionService } from './comment-transcription.service';
import { LinesController } from './list.controller';
import { VoiceRecordingInterceptor } from './voice-recording.interceptor';

/**
 * `PATCH /v1/lines/:id` with a favourite and a chain, over real HTTP (plan
 * 0199).
 *
 * Over HTTP because the whole claim is about what the validation pipe leaves
 * on the body. **A JSON null must reach core as null, and an absent key must
 * not reach core at all.** `@IsOptional()` treats both as "skip the
 * validators", so a DTO spec alone cannot tell them apart. The message that the
 * gateway sends is serialized as the broker serializes it, which is where an
 * `undefined` key disappears and a null does not.
 */

const LINE = 'cf000000-0000-4000-a000-0000000000aa';
const ITEM = 'cf000000-0000-4000-a000-0000000000bb';
const CHAIN = 'cf000000-0000-4000-a000-0000000000cc';

async function boot() {
  const sent: { subject: unknown; payload: Record<string, unknown> }[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [LinesController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: unknown, payload: unknown) => {
              // What the broker carries: JSON, so `undefined` keys are gone.
              sent.push({
                subject,
                payload: JSON.parse(JSON.stringify(payload)),
              });
              return { id: LINE };
            },
          },
        },
        { provide: CommentTranscriptionService, useValue: {} },
        { provide: SettlePriceService, useValue: {} },
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
      // The voice comment route of the same controller reads its limits from
      // configuration. This file never calls it.
      .overrideInterceptor(VoiceRecordingInterceptor)
      .useValue({
        intercept: (_: unknown, next: { handle(): unknown }) => next.handle(),
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

describe('PATCH /v1/lines/:id, the favourite and the chain (plan 0199)', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  const patch = (body: unknown) =>
    fetch(`${app.origin}/v1/lines/${LINE}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    app = await boot();
  });

  afterAll(async () => {
    await app.nest.close();
  });

  beforeEach(() => {
    app.sent.length = 0;
  });

  it('sends both ids to core', async () => {
    const response = await patch({
      favoriteItemId: ITEM,
      preferredSupermarketId: CHAIN,
    });

    expect(response.status).toBe(200);
    expect(app.sent).toEqual([
      {
        subject: LINE_PATTERNS.update,
        payload: {
          userId: 'user-1',
          lineId: LINE,
          favoriteItemId: ITEM,
          preferredSupermarketId: CHAIN,
        },
      },
    ]);
  });

  it('sends a JSON null as null, which is how core is told to clear', async () => {
    const response = await patch({
      favoriteItemId: null,
      preferredSupermarketId: null,
    });

    expect(response.status).toBe(200);
    expect(app.sent[0].payload).toEqual({
      userId: 'user-1',
      lineId: LINE,
      favoriteItemId: null,
      preferredSupermarketId: null,
    });
  });

  it('sends no key for an absent field, which is how core is told to leave it alone', async () => {
    const response = await patch({ quantity: 3 });

    expect(response.status).toBe(200);
    expect(app.sent[0].payload).toEqual({
      userId: 'user-1',
      lineId: LINE,
      quantity: 3,
    });
    expect(app.sent[0].payload).not.toHaveProperty('favoriteItemId');
    expect(app.sent[0].payload).not.toHaveProperty('preferredSupermarketId');
  });

  it('clears one and leaves the other alone in one request', async () => {
    await patch({ favoriteItemId: null });

    expect(app.sent[0].payload).toHaveProperty('favoriteItemId', null);
    expect(app.sent[0].payload).not.toHaveProperty('preferredSupermarketId');
  });

  it.each([
    ['favoriteItemId', 'milk'],
    ['favoriteItemId', 7],
    ['favoriteItemId', ''],
    ['preferredSupermarketId', 'mercadona'],
    ['preferredSupermarketId', [CHAIN]],
  ])(
    'refuses a %s that is not a UUID (%p), and asks core nothing',
    async (field, value) => {
      const response = await patch({ [field]: value });

      expect(response.status).toBe(400);
      expect(app.sent).toHaveLength(0);
    }
  );
});

describe('the add routes take neither field (plan 0199, rule 7)', () => {
  it('has no such property on either add DTO', async () => {
    const { AddLineDto, AddLinesItemDto } = await import('./list.dto');
    const { getMetadataStorage } = await import('class-validator');
    const validated = (target: unknown) =>
      getMetadataStorage()
        .getTargetValidationMetadatas(target as never, '', false, false)
        .map((metadata) => metadata.propertyName);

    for (const dto of [AddLineDto, AddLinesItemDto]) {
      expect(validated(dto)).not.toContain('favoriteItemId');
      expect(validated(dto)).not.toContain('preferredSupermarketId');
    }
  });
});
