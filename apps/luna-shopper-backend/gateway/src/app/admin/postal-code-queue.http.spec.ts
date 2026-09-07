import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { AdminHarvestPostalCodesController } from '../harvest/harvest.controller';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminPostalCodesController,
  AdminProfilePostalCodesController,
} from './admin-core.controller';
import { AdminJwtGuard } from './admin-jwt.guard';
import { AdminUserNamesService } from './admin-user-names.service';

/**
 * The postal code queue's routes over real HTTP (plan 0097).
 *
 * Over HTTP rather than as handler calls, because two of the three things being
 * checked live outside the handler: the global pipe validates the query object,
 * so a value it refuses is a 400 the handler never sees, and the guard runs
 * before the handler at all.
 *
 * The broker is stubbed, so nothing here needs the compose stack. What each
 * route sends is asserted instead, which is the seam the gateway actually owns:
 * every one of these is a proxy, and the shape it forwards is the whole of its
 * behaviour.
 */

interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

async function boot(answer: unknown = { items: [], nextCursor: null }) {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: [
        AdminHarvestPostalCodesController,
        AdminPostalCodesController,
        AdminProfilePostalCodesController,
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
              return answer;
            },
          },
        },
        {
          provide: AdminUserNamesService,
          useValue: { decorateZones: async (_a: unknown, p: unknown) => p },
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

function guardsOf(controller: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? [];
}

/**
 * Section 11's first gateway line: every route refuses a velista user token and
 * accepts an admin token.
 *
 * Read off the controller metadata rather than by sending a token, because the
 * guard is the only place the answer exists: a velista access token is signed
 * with a key {@link AdminJwtGuard} does not verify against, so what has to be
 * true is that this guard is the one on the class.
 */
describe('the postal code routes are operator gated (plan 0097)', () => {
  it.each([
    ['the discovery queue', AdminHarvestPostalCodesController],
    ['the shipped centroid table', AdminPostalCodesController],
    ['the demand behind a code', AdminProfilePostalCodesController],
  ])('guards %s with the admin guard', (_name, controller) => {
    expect(guardsOf(controller)).toContain(AdminJwtGuard);
  });
});

describe('GET /v1/admin/harvest/postal-codes', () => {
  it('forwards the working set by default and the filters when given', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/harvest/postal-codes?postalCode=140&status=FAILED`
      );

      expect(res.status).toBe(200);
      expect(sent[0].payload).toMatchObject({
        postalCode: '140',
        status: 'FAILED',
      });
      // Absent, which the harvester reads as the undismissed rows.
      expect(sent[0].payload['dismissed']).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  it('asks for the dismissed rows when told to', async () => {
    const { nest, sent, origin } = await boot();
    try {
      await fetch(`${origin}/v1/admin/harvest/postal-codes?dismissed=true`);

      expect(sent[0].payload['dismissed']).toBe(true);
    } finally {
      await nest.close();
    }
  });

  /**
   * The value goes into a `LIKE` prefix, so a `%` would match every code, which
   * reads as a filter that does nothing rather than one that found nothing. It
   * is refused at the door rather than escaped in the query.
   */
  it('refuses a wildcard in the code', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/harvest/postal-codes?postalCode=%25`
      );

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });
});

describe('POST /v1/admin/harvest/postal-codes', () => {
  it('sends the code and the operator’s choice of whether to run it', async () => {
    const { nest, sent, origin } = await boot({ id: 'q-1' });
    try {
      const res = await fetch(`${origin}/v1/admin/harvest/postal-codes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          country: 'es',
          postalCode: '14013',
          discoverNow: false,
        }),
      });

      expect(res.status).toBe(201);
      expect(sent[0].subject).toBe('postalCodeDiscovery.add');
      expect(sent[0].payload).toMatchObject({
        country: 'es',
        postalCode: '14013',
        discoverNow: false,
      });
    } finally {
      await nest.close();
    }
  });

  it('refuses a body with no choice about running it', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/harvest/postal-codes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ country: 'es', postalCode: '14013' }),
      });

      expect(res.status).toBe(400);
      expect(sent).toHaveLength(0);
    } finally {
      await nest.close();
    }
  });
});

describe('the two writes on one queue row', () => {
  it('requeues by id', async () => {
    const { nest, sent, origin } = await boot({ id: 'q-1' });
    try {
      const res = await fetch(
        `${origin}/v1/admin/harvest/postal-codes/q-1/requeue`,
        { method: 'POST' }
      );

      expect(res.status).toBe(201);
      expect(sent[0].subject).toBe('postalCodeDiscovery.requeue');
      expect(sent[0].payload['requestId']).toBe('q-1');
    } finally {
      await nest.close();
    }
  });

  it('dismisses by id', async () => {
    const { nest, sent, origin } = await boot({ id: 'q-1' });
    try {
      await fetch(`${origin}/v1/admin/harvest/postal-codes/q-1/dismiss`, {
        method: 'POST',
      });

      expect(sent[0].subject).toBe('postalCodeDiscovery.dismiss');
      expect(sent[0].payload['requestId']).toBe('q-1');
    } finally {
      await nest.close();
    }
  });

  /**
   * `summary` is a fixed segment on the same controller as `:id`, so route order
   * decides whether it is read as an id. Nest matches in declaration order and
   * the summary is declared first; this is what fails if somebody moves it.
   */
  it('reads the summary as a route rather than as a row id', async () => {
    const { nest, sent, origin } = await boot({ queued: 0 });
    try {
      const res = await fetch(
        `${origin}/v1/admin/harvest/postal-codes/summary`
      );

      expect(res.status).toBe(200);
      expect(sent[0].subject).toBe('postalCodeDiscovery.summary');
    } finally {
      await nest.close();
    }
  });
});

/**
 * Plan 0074 refused a gateway route over `postalCode.nearby` because it would be
 * "a geocoding service nobody asked for". Plan 0097 section 4 narrows that: this
 * one is admin gated and answers about a code an operator is already looking at.
 */
describe('GET /v1/admin/catalog/postal-codes/{code}/nearby', () => {
  it('defaults the country and the radius the profile widening uses', async () => {
    const { nest, sent, origin } = await boot({
      country: 'es',
      postalCode: '14013',
      known: true,
      postalCodes: [],
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/postal-codes/14013/nearby`
      );

      expect(res.status).toBe(200);
      expect(sent[0].subject).toBe('postalCode.nearby');
      expect(sent[0].payload).toEqual({
        country: 'es',
        postalCode: '14013',
        radiusMetres: 2000,
      });
    } finally {
      await nest.close();
    }
  });

  it('takes a radius when one is given', async () => {
    const { nest, sent, origin } = await boot({ known: false });
    try {
      await fetch(
        `${origin}/v1/admin/catalog/postal-codes/14013/nearby?radiusMetres=5000`
      );

      expect(sent[0].payload['radiusMetres']).toBe(5000);
    } finally {
      await nest.close();
    }
  });

  /**
   * A code outside the table answers `known: false` rather than an empty list
   * that looks the same, and the route passes that through untouched: "nothing
   * within 2 km" and "we have no idea where this is" are different answers.
   */
  it('passes an unknown code through as known false', async () => {
    const { nest, origin } = await boot({
      country: 'es',
      postalCode: '99999',
      known: false,
      postalCodes: [],
    });
    try {
      const res = await fetch(
        `${origin}/v1/admin/catalog/postal-codes/99999/nearby`
      );

      await expect(res.json()).resolves.toMatchObject({
        known: false,
        postalCodes: [],
      });
    } finally {
      await nest.close();
    }
  });
});

describe('GET /v1/admin/profiles/postal-codes/usage', () => {
  it('reads a repeated parameter as the page of codes', async () => {
    const { nest, sent, origin } = await boot({ country: 'es', usage: [] });
    try {
      const res = await fetch(
        `${origin}/v1/admin/profiles/postal-codes/usage` +
          `?postalCodes=14013&postalCodes=14010`
      );

      expect(res.status).toBe(200);
      expect(sent[0].subject).toBe('adminProfilePostalCode.usage');
      expect(sent[0].payload['postalCodes']).toEqual(['14013', '14010']);
    } finally {
      await nest.close();
    }
  });

  it('reads a comma separated parameter the same way', async () => {
    const { nest, sent, origin } = await boot({ country: 'es', usage: [] });
    try {
      await fetch(
        `${origin}/v1/admin/profiles/postal-codes/usage?postalCodes=14013,14010`
      );

      expect(sent[0].payload['postalCodes']).toEqual(['14013', '14010']);
    } finally {
      await nest.close();
    }
  });

  it('refuses a request that names no codes', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(
        `${origin}/v1/admin/profiles/postal-codes/usage?country=es`
      );

      expect(res.status).toBe(400);
      expect(sent).toHaveLength(0);
    } finally {
      await nest.close();
    }
  });
});
