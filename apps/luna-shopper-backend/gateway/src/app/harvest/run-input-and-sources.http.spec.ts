import { Test } from '@nestjs/testing';
import {
  HARVEST_PATTERNS,
  SUPERMARKET_SOURCE_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminHarvestRunsController,
  AdminHarvestSourcesController,
} from './harvest.controller';

/**
 * Owner decisions 114a and 119b, over HTTP through the real pipe.
 *
 * 114a: a run's view carries the run's own request, on the single read and on
 * every row of the list, and the gateway passes it through as the harvester
 * answered it. 119b: the sources list takes a plain page query, so a run
 * filter is refused rather than accepted and ignored.
 */

interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

const INPUT = {
  mode: 'CATALOG_DISCOVERY',
  priceScopeIds: ['scope-a'],
  writes: 'PRICES_AND_AVAILABILITY',
  details: 'NEW',
};

const FINGERPRINT = 'f'.repeat(64);

const RUN = {
  id: 'run-1',
  mode: 'CATALOG_DISCOVERY',
  input: INPUT,
  configFingerprint: FINGERPRINT,
  adapterKey: 'carrefour-web',
};
const OLD_RUN = {
  id: 'run-2',
  mode: 'CATALOG_DISCOVERY',
  input: null,
  configFingerprint: null,
  adapterKey: null,
};

async function boot() {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [AdminHarvestRunsController, AdminHarvestSourcesController],
      providers: [
        {
          provide: NatsClient,
          useValue: {
            send: async (
              subject: unknown,
              payload: Record<string, unknown>
            ) => {
              sent.push({ subject, payload });
              if (subject === HARVEST_PATTERNS.runGet) {
                return RUN;
              }
              if (subject === HARVEST_PATTERNS.runList) {
                return { items: [RUN, OLD_RUN], nextCursor: null };
              }
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

describe('the run views carry the run request (owner decision 114a)', () => {
  let context: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await context?.nest.close();
    context = undefined;
  });

  it('passes the input through on the single read', async () => {
    context = await boot();

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/runs/0b0c6a52-5a5e-4c2e-9d7e-7a1f2b3c4d5e`
    );

    expect(response.status).toBe(200);
    expect((await response.json()).input).toEqual(INPUT);
  });

  it('passes the input through on every row of the list, null included', async () => {
    context = await boot();

    const response = await fetch(`${context.origin}/v1/admin/harvest/runs`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((item: { input: unknown }) => item.input)).toEqual([
      INPUT,
      null,
    ]);
  });

  it('passes the walk configuration digest and the adapter through, null included (owner decisions 130b and 127b)', async () => {
    context = await boot();

    const one = await (
      await fetch(
        `${context.origin}/v1/admin/harvest/runs/0b0c6a52-5a5e-4c2e-9d7e-7a1f2b3c4d5e`
      )
    ).json();
    expect(one).toMatchObject({
      configFingerprint: FINGERPRINT,
      adapterKey: 'carrefour-web',
    });

    const list = await (
      await fetch(`${context.origin}/v1/admin/harvest/runs`)
    ).json();
    expect(
      list.items.map(
        (item: { configFingerprint: unknown; adapterKey: unknown }) => [
          item.configFingerprint,
          item.adapterKey,
        ]
      )
    ).toEqual([
      [FINGERPRINT, 'carrefour-web'],
      [null, null],
    ]);
  });

  it('documents the field on the run view, as a run input record or null', () => {
    // The committed document, which openapi-document.spec.ts keeps current.
    const document = JSON.parse(
      readFileSync(join(__dirname, '../../../docs/openapi.json'), 'utf8')
    ) as { components: { schemas: Record<string, Record<string, unknown>> } };
    const view = document.components.schemas['harvest.HarvestRunView'] as {
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(view).toBeDefined();
    expect(JSON.stringify(view.properties['input'])).toContain(
      'HarvestRunInputRecord'
    );
    expect(JSON.stringify(view.properties['input'])).toContain('null');
    // Not required, so the back office's typed fixtures stay valid, and a
    // gateway in front of an older harvester answers a valid view.
    expect(view.required).not.toContain('input');
    expect(view.required).not.toContain('configFingerprint');
    expect(view.required).not.toContain('adapterKey');
    expect(JSON.stringify(view.properties['configFingerprint'])).toContain(
      'null'
    );
    expect(JSON.stringify(view.properties['adapterKey'])).toContain(
      'AdapterKey'
    );

    // A file import states its source kind and its window (owner decision
    // 129b), and a preset still cannot carry them.
    const record = document.components.schemas[
      'harvest.HarvestRunInputRecord'
    ] as { properties: Record<string, unknown> };
    const preset = document.components.schemas[
      'harvest.HarvestRunPresetInput'
    ] as { properties: Record<string, unknown> };
    for (const field of ['sourceKind', 'validFrom', 'validUntil']) {
      expect(record.properties).toHaveProperty(field);
      expect(preset.properties).not.toHaveProperty(field);
    }
  });
});

describe('GET /v1/admin/harvest/sources takes a page query (owner decision 119b)', () => {
  let context: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    await context?.nest.close();
    context = undefined;
  });

  it('sends the cursor and the size the back office sends', async () => {
    context = await boot();

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/sources?cursor=abc&limit=50`
    );

    expect(response.status).toBe(200);
    expect(context.sent[0].subject).toBe(SUPERMARKET_SOURCE_PATTERNS.list);
    expect(context.sent[0].payload).toMatchObject({ cursor: 'abc', limit: 50 });
  });

  it('answers a bare read', async () => {
    context = await boot();

    const response = await fetch(`${context.origin}/v1/admin/harvest/sources`);

    expect(response.status).toBe(200);
  });

  it.each([
    'reverted=true',
    'status=COMPLETED',
    'mode=CATALOG_DISCOVERY',
    'supermarketId=0b0c6a52-5a5e-4c2e-9d7e-7a1f2b3c4d5e',
    'presetId=0b0c6a52-5a5e-4c2e-9d7e-7a1f2b3c4d5e',
    'trigger=SCHEDULED',
  ])('refuses ?%s, a run filter it never read', async (query) => {
    context = await boot();

    const response = await fetch(
      `${context.origin}/v1/admin/harvest/sources?${query}`
    );

    expect(response.status).toBe(400);
    expect(context.sent).toHaveLength(0);
  });
});
