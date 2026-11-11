import { Test } from '@nestjs/testing';
import {
  LINE_PATTERNS,
  type LineQuantityResult,
  type UpdateLineResult,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettlePriceService } from '../baskets/settle-price.service';
import { NatsClient } from '../messaging/nats-client';
import { CommentTranscriptionService } from './comment-transcription.service';
import { LinesController } from './list.controller';
import { VoiceRecordingInterceptor } from './voice-recording.interceptor';

/**
 * The two answers of a line deleted at 0 over real HTTP (plan 0263, section 3
 * and section 6, item 8): `POST /v1/lines/:id/quantity` answers 201 and
 * `PATCH /v1/lines/:id` 200, each with core's line at 0 and `deleted: true`,
 * passed through unchanged.
 */

const LINE = 'cf000000-0000-4000-a000-0000000000e1';

const AT_ZERO = {
  id: LINE,
  listId: 'cf000000-0000-4000-a000-0000000000e2',
  content: 'Oat drink',
  quantity: 0,
  unit: 'GRAM',
  itemIds: ['cf000000-0000-4000-a000-0000000000e3'],
  named: false,
  deleted: true,
} as const;

async function boot() {
  const nest = (
    await Test.createTestingModule({
      controllers: [LinesController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: unknown) => {
              if (subject === LINE_PATTERNS.addQuantity) {
                return AT_ZERO as unknown as LineQuantityResult;
              }
              if (subject === LINE_PATTERNS.update) {
                return AT_ZERO as unknown as UpdateLineResult;
              }
              throw new Error(`unexpected subject ${String(subject)}`);
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
      .overrideInterceptor(VoiceRecordingInterceptor)
      .useValue({
        intercept: (_: unknown, next: { handle(): unknown }) => next.handle(),
      })
      .compile()
  ).createNestApplication();

  nest.useGlobalPipes(createValidationPipe());
  nest.useGlobalFilters(
    new GlobalExceptionFilter({
      setContext: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as ConstructorParameters<typeof GlobalExceptionFilter>[0])
  );
  nest.setGlobalPrefix('v1');
  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, origin: `http://127.0.0.1:${port}` };
}

describe('a line deleted at zero, over HTTP (plan 0263)', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot();
  });

  afterAll(async () => {
    await app.nest.close();
  });

  const send = (method: string, path: string, body: unknown) =>
    fetch(`${app.origin}/v1/${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('answers the delta 201 with the line at 0 and deleted', async () => {
    const response = await send('POST', `lines/${LINE}/quantity`, {
      delta: -25,
      unit: 'GRAM',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(AT_ZERO);
  });

  it('answers the edit 200 with the line at 0 and deleted', async () => {
    const response = await send('PATCH', `lines/${LINE}`, { quantity: 0 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(AT_ZERO);
  });
});
