import { Test } from '@nestjs/testing';
import {
  BRAND_PATTERNS,
  SOURCE_ENTRY_PATTERNS,
  type BrandMatchView,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { AdminHarvestEntriesController } from './harvest.controller';

/**
 * The queue with the brands each printed brand names, over real HTTP
 * (plan 0178).
 *
 * The route is composed, so what has to be true about it is the order of the
 * two reads, the keys catalog is asked for, and which row each answer lands on.
 */

const POSEIDON: BrandMatchView = {
  brandId: '11111111-1111-4111-8111-111111111178',
  key: 'poseidon',
  label: 'Poseidon',
  privateLabelSupermarketId: null,
  printedAs: null,
};
const POSEIDON_FOOD: BrandMatchView = {
  brandId: '22222222-2222-4222-8222-222222222178',
  key: 'poseidonfood',
  label: 'Poseidon Food',
  privateLabelSupermarketId: null,
  printedAs: null,
};

/** What the stub broker answers, by subject. */
type Answers = Record<string, unknown>;

async function boot(answers: Answers) {
  const sent: Array<{ subject: string; payload: Record<string, unknown> }> = [];
  const nest = (
    await Test.createTestingModule({
      controllers: [AdminHarvestEntriesController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              return answers[subject];
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
            token: 'operator-token',
          };
          return true;
        },
      })
      .compile()
  ).createNestApplication();

  nest.useGlobalPipes(createValidationPipe());
  const logger = {
    setContext: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  nest.useGlobalFilters(
    new GlobalExceptionFilter(
      logger as unknown as ConstructorParameters<
        typeof GlobalExceptionFilter
      >[0]
    )
  );
  nest.setGlobalPrefix('v1');

  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

describe('the queue names the brands a printed brand answers to (plan 0178)', () => {
  let context: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await context?.nest.close();
    context = undefined;
  });

  it('asks catalog once for the distinct keys of the page, and puts each answer on its rows', async () => {
    context = await boot({
      [SOURCE_ENTRY_PATTERNS.list]: {
        items: [
          { id: 'e1', brand: 'Poseidón' },
          { id: 'e2', brand: 'POSEIDON' },
          { id: 'e3', brand: 'Marca Nueva' },
          { id: 'e4', brand: null },
          { id: 'e5', brand: '---' },
        ],
        nextCursor: 'next',
      },
      [BRAND_PATTERNS.matches]: {
        matches: [
          { printedKey: 'poseidon', brands: [POSEIDON, POSEIDON_FOOD] },
        ],
      },
    });

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/entries?limit=5`
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        // The key's own brand first, then the brand the homonym points at.
        {
          id: 'e1',
          brand: 'Poseidón',
          brandMatches: [POSEIDON, POSEIDON_FOOD],
        },
        {
          id: 'e2',
          brand: 'POSEIDON',
          brandMatches: [POSEIDON, POSEIDON_FOOD],
        },
        // A key nothing registered answers to, no brand, and a text that
        // makes no key: all three are the empty list, never an absent field.
        { id: 'e3', brand: 'Marca Nueva', brandMatches: [] },
        { id: 'e4', brand: null, brandMatches: [] },
        { id: 'e5', brand: '---', brandMatches: [] },
      ],
      nextCursor: 'next',
    });
    expect(context.sent.map((message) => message.subject)).toEqual([
      SOURCE_ENTRY_PATTERNS.list,
      BRAND_PATTERNS.matches,
    ]);
    // Two spellings of one key are one key, and a row with no key asks nothing.
    expect(context.sent[1].payload).toEqual({
      userId: 'admin-1',
      keys: ['poseidon', 'marcanueva'],
    });
  });

  it('does not ask catalog at all for a page that prints no brand', async () => {
    context = await boot({
      [SOURCE_ENTRY_PATTERNS.list]: {
        items: [{ id: 'e1', brand: null }],
        nextCursor: null,
      },
    });

    const response = await fetch(`${context.origin}/v1/admin/harvest/entries`);

    expect(await response.json()).toEqual({
      items: [{ id: 'e1', brand: null, brandMatches: [] }],
      nextCursor: null,
    });
    expect(context.sent.map((message) => message.subject)).toEqual([
      SOURCE_ENTRY_PATTERNS.list,
    ]);
  });

  it('still hands the harvester the filters it was asked with', async () => {
    context = await boot({
      [SOURCE_ENTRY_PATTERNS.list]: { items: [], nextCursor: null },
    });

    await fetch(
      `${context.origin}/v1/admin/harvest/entries?brandKey=El%20Pozo&limit=25&cursor=abc`
    );

    expect(context.sent[0].payload).toMatchObject({
      userId: 'admin-1',
      adminToken: 'operator-token',
      brandKey: 'El Pozo',
      cursor: 'abc',
      limit: 25,
    });
  });

  it('publishes brandMatches as a required field of every queued row', () => {
    const document = JSON.parse(
      readFileSync(join(__dirname, '../../../docs/openapi.json'), 'utf8')
    ) as {
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, { required: string[] }> };
    };
    const { schemas } = document.components;

    expect(schemas['harvest.QueuedSourceEntryView'].required).toContain(
      'brandMatches'
    );
    expect(schemas['harvest.QueuedSourceEntryView'].required).toContain(
      'status'
    );
    expect(
      JSON.stringify(document.paths['/v1/admin/harvest/entries'])
    ).toContain('harvest.QueuedSourceEntryPage');
  });
});
