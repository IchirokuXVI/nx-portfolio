import { Test } from '@nestjs/testing';
import { LINE_PATTERNS } from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AddressInfo } from 'node:net';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AddBasketLineDto } from '../baskets/basket.dto';
import { SettlePriceService } from '../baskets/settle-price.service';
import { NatsClient } from '../messaging/nats-client';
import { CommentTranscriptionService } from './comment-transcription.service';
import { LinesController, ListsController } from './list.controller';
import { VoiceRecordingInterceptor } from './voice-recording.interceptor';

/**
 * The question a typed name can raise, and its two answers, over real HTTP
 * (plan 0228, target 2).
 *
 * Over HTTP for the reason `line-named.http.spec.ts` gives: the claim is about
 * what the validation pipe leaves on the body. A JSON true or false reaches
 * core as it was sent, an absent field does not reach core at all, and a body
 * that sends `intoLineId` beside `newLine: true` is refused before core hears
 * of it.
 */

const LIST = 'cf000000-0000-4000-a000-0000000000b1';
const LINE = 'cf000000-0000-4000-a000-0000000000b2';
const ITEM = 'cf000000-0000-4000-a000-0000000000b3';

async function boot() {
  const sent: { subject: unknown; payload: Record<string, unknown> }[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [ListsController, LinesController],
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
              return { line: { id: LINE }, merged: true };
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
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;

  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

describe('POST /v1/lists/:id/lines asks which line (plan 0228)', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  const post = (body: unknown) =>
    fetch(`${app.origin}/v1/lists/${LIST}/lines`, {
      method: 'POST',
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

  it('sends the three fields to core as the body spelled them', async () => {
    const asks = await post({ content: 'Leche entera', askIfAmbiguous: true });
    const chose = await post({ content: 'Leche entera', intoLineId: LINE });
    const fresh = await post({
      content: 'Leche entera',
      askIfAmbiguous: false,
      newLine: true,
    });

    expect([asks.status, chose.status, fresh.status]).toEqual([201, 201, 201]);
    expect(app.sent.map((entry) => entry.subject)).toEqual([
      LINE_PATTERNS.add,
      LINE_PATTERNS.add,
      LINE_PATTERNS.add,
    ]);
    expect(app.sent.map((entry) => entry.payload)).toEqual([
      {
        userId: 'user-1',
        listId: LIST,
        content: 'Leche entera',
        askIfAmbiguous: true,
      },
      {
        userId: 'user-1',
        listId: LIST,
        content: 'Leche entera',
        intoLineId: LINE,
      },
      {
        userId: 'user-1',
        listId: LIST,
        content: 'Leche entera',
        askIfAmbiguous: false,
        newLine: true,
      },
    ]);
  });

  it('sends none of them when the body has none, so an older client asks nothing', async () => {
    await post({ content: 'Bread' });

    expect(app.sent[0].payload).not.toHaveProperty('askIfAmbiguous');
    expect(app.sent[0].payload).not.toHaveProperty('intoLineId');
    expect(app.sent[0].payload).not.toHaveProperty('newLine');
  });

  it('refuses intoLineId beside newLine true, and sends nothing', async () => {
    const response = await post({
      content: 'Leche entera',
      intoLineId: LINE,
      newLine: true,
    });

    expect(response.status).toBe(400);
    expect(app.sent).toEqual([]);
  });

  it('takes intoLineId beside newLine false', async () => {
    const response = await post({
      content: 'Leche entera',
      intoLineId: LINE,
      newLine: false,
    });

    expect(response.status).toBe(201);
  });

  // The pipe converts a body implicitly, and that conversion reads every one
  // of these as a boolean. "false" would arrive as true.
  it.each([
    ['askIfAmbiguous', 'false'],
    ['askIfAmbiguous', 1],
    ['newLine', 'true'],
    ['newLine', [true]],
  ])('refuses %s %j, which is not a JSON boolean', async (field, value) => {
    const response = await post({ content: 'Bread', [field]: value });

    expect(response.status).toBe(400);
    expect(app.sent).toEqual([]);
  });

  it('refuses an intoLineId that is not a uuid', async () => {
    const response = await post({ content: 'Bread', intoLineId: 'li-1' });

    expect(response.status).toBe(400);
    expect(app.sent).toEqual([]);
  });

  it('takes the three fields beside a product, which core then ignores', async () => {
    const response = await post({
      content: 'Leche entera',
      itemIds: [ITEM],
      askIfAmbiguous: true,
    });

    expect(response.status).toBe(201);
    expect(app.sent[0].payload).toMatchObject({ askIfAmbiguous: true });
  });
});

describe('POST /v1/baskets/:id/lines takes the same fields (plan 0228)', () => {
  const errors = async (body: object): Promise<string[]> =>
    (await validate(plainToInstance(AddBasketLineDto, body))).map(
      (failure) => failure.property
    );
  const base = { targetListId: LIST, content: 'Leche entera' };

  it('accepts each answer, and their absence', async () => {
    expect(await errors(base)).toEqual([]);
    expect(await errors({ ...base, askIfAmbiguous: true })).toEqual([]);
    expect(await errors({ ...base, intoLineId: LINE })).toEqual([]);
    expect(await errors({ ...base, newLine: true })).toEqual([]);
    expect(
      plainToInstance(AddBasketLineDto, { ...base, askIfAmbiguous: false })
        .askIfAmbiguous
    ).toBe(false);
  });

  it('refuses intoLineId beside newLine true', async () => {
    expect(await errors({ ...base, intoLineId: LINE, newLine: true })).toEqual([
      'intoLineId',
    ]);
  });

  it('refuses a flag that is not a boolean, and an id that is not a uuid', async () => {
    expect(await errors({ ...base, askIfAmbiguous: 'yes' })).toEqual([
      'askIfAmbiguous',
    ]);
    expect(await errors({ ...base, newLine: 0 })).toEqual(['newLine']);
    expect(await errors({ ...base, intoLineId: 'li-1' })).toEqual([
      'intoLineId',
    ]);
  });
});
