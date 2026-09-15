import {
  AUTH_PATTERNS,
  GENERATED_LIST_PATTERNS,
  GeneratedListStatus,
  type SharedGeneratedListCoreView,
} from '@portfolio/luna-shopper/contracts';
import type { CurrentUser } from '../auth/jwt.strategy';
import {
  GENERATED_LIST_SHARING_CONTROLLERS,
  GeneratedListParticipantController,
  GeneratedListShareController,
} from './generated-list-sharing.controller';
import { GeneratedListController } from './generated-list.controller';

/**
 * The gateway half of sharing a basket with people you know (plan 0114).
 *
 * Core decides who may be added and whose rows a person holds, and the
 * integration spec there proves it. What is left here is composition: naming
 * the owner of a shared basket from two services (section 9), handing core the
 * names of the people being added, and keeping the leave route reachable at
 * all (section 6).
 */

const READER: CurrentUser = { userId: 'u-reader' } as CurrentUser;

function coreRow(
  id: string,
  ownerUserId: string,
  ownerZoneUsername: string | null
): SharedGeneratedListCoreView {
  return {
    id,
    name: null,
    status: GeneratedListStatus.ACTIVE,
    generatedAt: '2026-09-01T08:00:00.000Z',
    lineCount: 3,
    settledLineCount: 1,
    boughtLineCount: 1,
    notAvailableLineCount: 0,
    presentCount: 0,
    ownerUserId,
    ownerZoneUsername,
    sharedAt: '2026-09-02T08:00:00.000Z',
  };
}

function harness(answers: {
  items: SharedGeneratedListCoreView[];
  usernames?: () => Promise<unknown>;
}) {
  const nats = {
    send: jest.fn(async (pattern: string, payload: unknown) => {
      if (pattern === GENERATED_LIST_PATTERNS.listShared) {
        return { items: answers.items, nextCursor: 'next' };
      }
      if (pattern === AUTH_PATTERNS.getUsernames) {
        return answers.usernames ? answers.usernames() : [];
      }
      if (pattern === GENERATED_LIST_PATTERNS.create) {
        return { list: { id: 'gl-new' }, skipped: [], sent: payload };
      }
      throw new Error(`unexpected pattern ${pattern}`);
    }),
  };
  const presence = {
    countsFor: jest.fn(async () => new Map([['gl-1', 2]])),
  };
  const controller = new GeneratedListController(
    nats as never,
    presence as never
  );
  return { controller, nats, presence };
}

describe('the shared baskets read names every owner (plan 0114, sections 8 and 9)', () => {
  it('keeps the group name core found, and asks auth once for the rest', async () => {
    const { controller, nats } = harness({
      items: [
        coreRow('gl-1', 'u-one', 'Mum'),
        coreRow('gl-2', 'u-two', null),
        coreRow('gl-3', 'u-two', null),
      ],
      usernames: async () => [{ userId: 'u-two', username: 'Two everywhere' }],
    });

    const page = await controller.listShared(READER, { limit: 3 });

    expect(page.nextCursor).toBe('next');
    expect(page.items.map((item) => item.owner)).toEqual([
      { userId: 'u-one', name: 'Mum' },
      { userId: 'u-two', name: 'Two everywhere' },
      { userId: 'u-two', name: 'Two everywhere' },
    ]);
    // Only the owners core could not name, and each of them once.
    expect(nats.send).toHaveBeenCalledWith(AUTH_PATTERNS.getUsernames, {
      userIds: ['u-two'],
    });
    expect(
      nats.send.mock.calls.filter(
        ([pattern]) => pattern === AUTH_PATTERNS.getUsernames
      )
    ).toHaveLength(1);
  });

  it('answers the route shape and nothing of core’s own', async () => {
    const { controller } = harness({
      items: [coreRow('gl-1', 'u-one', 'Mum')],
    });

    const [row] = (await controller.listShared(READER, {})).items;

    expect(row).toEqual({
      id: 'gl-1',
      name: null,
      status: GeneratedListStatus.ACTIVE,
      generatedAt: '2026-09-01T08:00:00.000Z',
      lineCount: 3,
      settledLineCount: 1,
      boughtLineCount: 1,
      notAvailableLineCount: 0,
      // Filled from presence on the way out, as the caller's own history is.
      presentCount: 2,
      owner: { userId: 'u-one', name: 'Mum' },
      sharedAt: '2026-09-02T08:00:00.000Z',
    });
  });

  it('asks auth nothing when core named every owner', async () => {
    const { controller, nats } = harness({
      items: [coreRow('gl-1', 'u-one', 'Mum')],
    });

    await controller.listShared(READER, {});

    expect(nats.send).not.toHaveBeenCalledWith(
      AUTH_PATTERNS.getUsernames,
      expect.anything()
    );
  });

  it('keeps the page when auth cannot answer, and leaves the name empty', async () => {
    const { controller } = harness({
      items: [coreRow('gl-2', 'u-two', null)],
      usernames: async () => {
        throw new Error('auth is down');
      },
    });

    const page = await controller.listShared(READER, {});

    expect(page.items[0].owner).toEqual({ userId: 'u-two', name: '' });
  });
});

describe('creating a basket shared with people (plan 0114, section 4)', () => {
  it('hands core the global names auth gave for the chosen people', async () => {
    const { controller, nats } = harness({
      items: [],
      usernames: async () => [{ userId: 'u-friend', username: 'Friend' }],
    });

    await controller.create(READER, {
      memberUserIds: ['u-friend'],
    } as never);

    expect(nats.send).toHaveBeenCalledWith(AUTH_PATTERNS.getUsernames, {
      userIds: ['u-friend'],
    });
    expect(nats.send).toHaveBeenCalledWith(GENERATED_LIST_PATTERNS.create, {
      userId: READER.userId,
      memberUserIds: ['u-friend'],
      globalUsernames: [{ userId: 'u-friend', username: 'Friend' }],
    });
  });

  it('never lets a body supply the names itself', async () => {
    const { controller, nats } = harness({ items: [] });

    await controller.create(READER, {
      globalUsernames: [{ userId: 'u-friend', username: 'Anything I like' }],
    } as never);

    expect(nats.send).toHaveBeenCalledWith(GENERATED_LIST_PATTERNS.create, {
      userId: READER.userId,
      globalUsernames: [],
    });
    // Nobody was chosen, so there was nobody to name.
    expect(nats.send).not.toHaveBeenCalledWith(
      AUTH_PATTERNS.getUsernames,
      expect.anything()
    );
  });
});

describe('leaving is reachable (plan 0114, section 6)', () => {
  it('registers the participant surface before the owner’s sheet', () => {
    // `DELETE :id/participants/:participantId` on the owner's sheet matches
    // `mine`, and the first route registered is the one that runs.
    expect(
      GENERATED_LIST_SHARING_CONTROLLERS.indexOf(
        GeneratedListParticipantController
      )
    ).toBeLessThan(
      GENERATED_LIST_SHARING_CONTROLLERS.indexOf(GeneratedListShareController)
    );
  });
});
