import { Test } from '@nestjs/testing';
import { createValidationPipe } from '@portfolio/luna-shopper/platform';
import type { AddressInfo } from 'node:net';
import { NatsClient } from '../messaging/nats-client';
import {
  AdminListLinesController,
  AdminListsController,
  AdminMembershipsController,
  AdminZonesController,
} from './admin-core.controller';
import { AdminJwtGuard } from './admin-jwt.guard';
import { AdminUserNamesService } from './admin-user-names.service';

/**
 * The zone listing's owner filter over real HTTP (admin plan 0012, section 3).
 *
 * The back office's picker sends the literal `none` on the same parameter a
 * uuid goes on, and this route is where it becomes the `withoutOwner` flag core
 * reads. It runs over HTTP rather than as a handler call because the global
 * pipe validates the whole query object, and a literal the validator does not
 * accept is a 400 the handler never sees.
 */

/** What the stub broker was last asked to send, so a spec can read it back. */
interface SentMessage {
  readonly subject: unknown;
  readonly payload: Record<string, unknown>;
}

async function boot(controllers: unknown[] = [AdminZonesController]) {
  const sent: SentMessage[] = [];

  const nest = (
    await Test.createTestingModule({
      controllers: controllers as never[],
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
        {
          // The names are a second call this spec is not about.
          provide: AdminUserNamesService,
          useValue: {
            decorateZones: async (_admin: unknown, page: unknown) => page,
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

describe('the zones nobody owns, over HTTP', () => {
  const OWNER = '0f6c3a2b-7d8e-4f90-a1b2-c3d4e5f60718';

  it('passes an owner id through as the owner', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/zones?ownerUserId=${OWNER}`);

      expect(res.status).toBe(200);
      expect(sent[0].payload['ownerUserId']).toBe(OWNER);
      expect(sent[0].payload['withoutOwner']).toBe(false);
      expect(sent[0].payload['targetUserId']).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  it('turns the literal none into the flag core reads', async () => {
    const { nest, sent, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/zones?ownerUserId=none`);

      expect(res.status).toBe(200);
      expect(sent[0].payload['ownerUserId']).toBeUndefined();
      expect(sent[0].payload['withoutOwner']).toBe(true);
    } finally {
      await nest.close();
    }
  });

  it('refuses anything that is neither a uuid nor the literal', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/zones?ownerUserId=nobody`);

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });

  /** The person filter keeps its own shape: a uuid, and no literal. */
  it('does not accept the literal on the person filter', async () => {
    const { nest, origin } = await boot();
    try {
      const res = await fetch(`${origin}/v1/admin/zones?userId=none`);

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });
});

/**
 * The two collections that read across their parent (admin plan 0017).
 *
 * Over HTTP for the reason the block above is: the parent is a query parameter
 * now, the global pipe validates the whole query object, and "absent is
 * allowed" is a claim about the validator rather than about the handler. The
 * two nested collections these replace are asserted gone in the same file,
 * because a route that answered the same question twice is what the plan
 * removed.
 */
describe('memberships and lines, addressed without their parent', () => {
  const ZONE = '0f6c3a2b-7d8e-4f90-a1b2-c3d4e5f60718';
  const LIST = '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

  it('narrows memberships to a zone when one is named', async () => {
    const { nest, sent, origin } = await boot([AdminMembershipsController]);
    try {
      const res = await fetch(`${origin}/v1/admin/memberships?zoneId=${ZONE}`);

      expect(res.status).toBe(200);
      expect(sent[0].payload['zoneId']).toBe(ZONE);
    } finally {
      await nest.close();
    }
  });

  it('lists memberships from every zone when none is named', async () => {
    const { nest, sent, origin } = await boot([AdminMembershipsController]);
    try {
      const res = await fetch(`${origin}/v1/admin/memberships`);

      expect(res.status).toBe(200);
      expect(sent[0].payload['zoneId']).toBeUndefined();
    } finally {
      await nest.close();
    }
  });

  it('refuses a zone that is not a uuid', async () => {
    const { nest, origin } = await boot([AdminMembershipsController]);
    try {
      const res = await fetch(`${origin}/v1/admin/memberships?zoneId=nowhere`);

      expect(res.status).toBe(400);
    } finally {
      await nest.close();
    }
  });

  it('narrows lines to a list, lists every list without one, and refuses a bad id', async () => {
    const { nest, sent, origin } = await boot([AdminListLinesController]);
    try {
      expect(
        (await fetch(`${origin}/v1/admin/list-lines?listId=${LIST}`)).status
      ).toBe(200);
      expect(sent[0].payload['listId']).toBe(LIST);

      expect((await fetch(`${origin}/v1/admin/list-lines`)).status).toBe(200);
      expect(sent[1].payload['listId']).toBeUndefined();

      expect(
        (await fetch(`${origin}/v1/admin/list-lines?listId=nowhere`)).status
      ).toBe(400);
    } finally {
      await nest.close();
    }
  });

  /** One question, one route. The nested collections answered it a second time. */
  it('no longer answers the nested collections it replaced', async () => {
    const { nest, origin } = await boot([
      AdminZonesController,
      AdminListsController,
      AdminMembershipsController,
      AdminListLinesController,
    ]);
    try {
      expect(
        (await fetch(`${origin}/v1/admin/zones/${ZONE}/members`)).status
      ).toBe(404);
      expect(
        (await fetch(`${origin}/v1/admin/lists/${LIST}/lines`)).status
      ).toBe(404);
    } finally {
      await nest.close();
    }
  });
});
