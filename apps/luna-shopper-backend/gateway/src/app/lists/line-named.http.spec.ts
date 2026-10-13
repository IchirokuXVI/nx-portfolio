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
 * The flag of a line on the three routes that take it, over real HTTP (plan
 * 0207, section 1.3).
 *
 * Over HTTP because the claim is about what the validation pipe leaves on the
 * body. **A JSON false must reach core as false, and an absent key must not
 * reach core at all**: core reads an absent flag beside a `content` as "a
 * person typed it", so a pipe that filled a default in would name every line.
 * The message is serialized as the broker serializes it, which is where an
 * `undefined` key disappears.
 */

const LIST = 'cf000000-0000-4000-a000-0000000000a1';
const LINE = 'cf000000-0000-4000-a000-0000000000a2';
const ITEM = 'cf000000-0000-4000-a000-0000000000a3';

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

describe('the flag of a line over HTTP (plan 0207)', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  const send = (method: string, path: string, body: unknown) =>
    fetch(`${app.origin}/v1/${path}`, {
      method,
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

  describe('POST /v1/lists/:id/lines', () => {
    it('sends false to core as false', async () => {
      const response = await send('POST', `lists/${LIST}/lines`, {
        content: 'Oat drink',
        itemIds: [ITEM],
        named: false,
      });

      expect(response.status).toBe(201);
      expect(app.sent).toEqual([
        {
          subject: LINE_PATTERNS.add,
          payload: {
            userId: 'user-1',
            listId: LIST,
            content: 'Oat drink',
            itemIds: [ITEM],
            named: false,
          },
        },
      ]);
    });

    it('sends no flag when the body has none, so an older client still names its lines', async () => {
      await send('POST', `lists/${LIST}/lines`, { content: 'Bread' });

      expect(app.sent[0].payload).not.toHaveProperty('named');
    });

    // The pipe converts a body implicitly, and that conversion reads every one
    // of these as a boolean. "false" would arrive as true and name the line.
    it.each([['false'], ['no'], [0], [[false]], [{}]])(
      'refuses %j, which is not a JSON boolean, and sends nothing',
      async (named) => {
        const response = await send('POST', `lists/${LIST}/lines`, {
          content: 'Bread',
          named,
        });

        expect(response.status).toBe(400);
        expect(app.sent).toHaveLength(0);
      }
    );
  });

  describe('POST /v1/lists/:id/lines/batch', () => {
    it('sends the flag of each item as it arrived', async () => {
      const response = await send('POST', `lists/${LIST}/lines/batch`, {
        items: [
          { content: 'Oat drink', itemIds: [ITEM], named: false },
          { content: 'Bread' },
          { content: 'Eggs', named: true },
        ],
      });

      expect(response.status).toBe(201);
      expect(app.sent[0].subject).toBe(LINE_PATTERNS.addMany);
      expect(app.sent[0].payload['items']).toEqual([
        { content: 'Oat drink', itemIds: [ITEM], named: false },
        { content: 'Bread' },
        { content: 'Eggs', named: true },
      ]);
    });

    it('refuses a batch that holds one flag that is not a boolean', async () => {
      const response = await send('POST', `lists/${LIST}/lines/batch`, {
        items: [{ content: 'Bread' }, { content: 'Eggs', named: 'no' }],
      });

      expect(response.status).toBe(400);
      expect(app.sent).toHaveLength(0);
    });
  });

  describe('PATCH /v1/lines/:id', () => {
    it('sends false beside a content, which takes the name away', async () => {
      const response = await send('PATCH', `lines/${LINE}`, {
        content: 'Whole milk 1 L',
        named: false,
      });

      expect(response.status).toBe(200);
      expect(app.sent).toEqual([
        {
          subject: LINE_PATTERNS.update,
          payload: {
            userId: 'user-1',
            lineId: LINE,
            content: 'Whole milk 1 L',
            named: false,
          },
        },
      ]);
    });

    it('sends false alone', async () => {
      await send('PATCH', `lines/${LINE}`, { named: false });

      expect(app.sent[0].payload).toEqual({
        userId: 'user-1',
        lineId: LINE,
        named: false,
      });
    });

    it('sends no flag for a content alone, which core reads as a person typing it', async () => {
      await send('PATCH', `lines/${LINE}`, { content: 'Milk' });

      expect(app.sent[0].payload).not.toHaveProperty('named');
    });

    it('refuses a flag that is not a boolean', async () => {
      const response = await send('PATCH', `lines/${LINE}`, { named: 'no' });

      expect(response.status).toBe(400);
      expect(app.sent).toHaveLength(0);
    });
  });
});

describe('POST /v1/baskets/:id/lines takes the same flag (plan 0207)', () => {
  const errors = async (body: object): Promise<string[]> =>
    (await validate(plainToInstance(AddBasketLineDto, body))).map(
      (failure) => failure.property
    );

  it('accepts a boolean and an absent flag', async () => {
    const base = { targetListId: LIST, content: 'Oat drink', itemIds: [ITEM] };

    expect(await errors({ ...base, named: false })).toEqual([]);
    expect(await errors({ ...base, named: true })).toEqual([]);
    expect(await errors(base)).toEqual([]);
    expect(
      plainToInstance(AddBasketLineDto, { ...base, named: false }).named
    ).toBe(false);
  });

  it('refuses a flag that is not a boolean', async () => {
    expect(
      await errors({ targetListId: LIST, content: 'Bread', named: 'no' })
    ).toEqual(['named']);
  });
});
