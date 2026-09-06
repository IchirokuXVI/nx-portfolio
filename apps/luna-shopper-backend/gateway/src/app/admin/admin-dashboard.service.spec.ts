import {
  ADMIN_AUTH_PATTERNS,
  ADMIN_DASHBOARD_PATTERNS,
  type AdminActivityEntry,
} from '@portfolio/luna-shopper/contracts';
import type { NatsClient } from '../messaging/nats-client';
import {
  AdminDashboardService,
  dashboardWindow,
  mergeActivity,
} from './admin-dashboard.service';
import type { CurrentAdmin } from './admin-jwt.strategy';

/**
 * The fan out behind `GET /v1/admin/dashboard` (plan 0088, sections 1, 2 and 4).
 *
 * Everything asserted here is a property of the composition rather than of any
 * count: that one broken subject costs one block, that the window is one
 * decision rather than four, and that the merged feed is capped and named.
 */
const ADMIN = {
  adminId: '11111111-1111-4111-8111-111111111111',
  token: 'operator-token',
} as CurrentAdmin;

const OTHER_ADMIN = '22222222-2222-4222-8222-222222222222';
const HARVESTER = '99999999-9999-4999-8999-999999999999';

function entry(overrides: Partial<AdminActivityEntry>): AdminActivityEntry {
  return {
    at: '2026-09-06T10:00:00.000Z',
    actorKind: 'ADMIN',
    actorId: ADMIN.adminId,
    entity: 'zones',
    entityId: 'z1',
    action: 'UPDATE',
    ...overrides,
  };
}

const IDENTITY = {
  users: { total: 4, registered: 3, temporary: 1, verified: 2 },
  signUps: [],
  admins: { total: 1, disabled: 0 },
  loginFailures: { last24h: 0, last7d: 0, recent: [] },
  activity: [
    entry({ entity: 'users', entityId: 'u1', at: '2026-09-06T09:00:00.000Z' }),
  ],
};

const CORE = {
  zones: { total: 2, active: 2, markedForDeletion: 0 },
  memberships: { pending: 1 },
  lists: { total: 5 },
  baskets: { total: 3, draft: 2, completed: 1 },
  zonesCreated: [],
  listsCreated: [],
  activity: [entry({ at: '2026-09-06T11:00:00.000Z' })],
};

const CATALOG = {
  supermarkets: 2,
  locations: 7,
  items: 100,
  productGroups: 4,
  supermarketItems: { total: 90, priced: 80, stale: 3, unavailable: 1 },
  pricesWritten: [],
  activity: [
    entry({
      at: '2026-09-06T10:30:00.000Z',
      actorKind: 'SERVICE',
      actorId: HARVESTER,
      entity: 'item_prices',
      entityId: 'p1',
      action: 'CREATE',
    }),
  ],
};

const HARVEST = {
  runs: { byStatus: [], inWindow: 0 },
  running: null,
  recent: [],
  queues: { entries: [], places: 0, shops: [] },
  sources: { total: 1, enabled: 0 },
};

const ROSTER = {
  admins: [
    {
      adminId: ADMIN.adminId,
      username: 'ichiroku',
      displayName: 'Daniel',
      lastLoginAt: null,
      disabledAt: null,
    },
    {
      adminId: OTHER_ADMIN,
      username: 'second',
      displayName: null,
      lastLoginAt: null,
      disabledAt: null,
    },
  ],
};

function answerFor(subject: string): unknown {
  switch (subject) {
    case ADMIN_DASHBOARD_PATTERNS.identity:
      return IDENTITY;
    case ADMIN_DASHBOARD_PATTERNS.core:
      return CORE;
    case ADMIN_DASHBOARD_PATTERNS.catalog:
      return CATALOG;
    case ADMIN_DASHBOARD_PATTERNS.harvest:
      return HARVEST;
    case ADMIN_AUTH_PATTERNS.listAdmins:
      return ROSTER;
    default:
      throw new Error(`no fake answer for ${subject}`);
  }
}

function build(answer: (subject: string) => unknown = answerFor): {
  svc: AdminDashboardService;
  send: jest.Mock;
} {
  const send = jest.fn(async (subject: string) => answer(subject));
  const nats = { send } as unknown as NatsClient;
  return { svc: new AdminDashboardService(nats), send };
}

describe('AdminDashboardService.dashboard', () => {
  it('composes all four blocks in one response', async () => {
    const { svc, send } = build();

    const body = await svc.dashboard(ADMIN);

    expect(body.identity).toEqual(IDENTITY);
    expect(body.core).toEqual(CORE);
    expect(body.catalog).toEqual(CATALOG);
    expect(body.harvest).toEqual(HARVEST);
    expect(body.measuredAt).toEqual(expect.any(String));
    expect(send.mock.calls.map((call) => call[0] as string).sort()).toEqual(
      [
        ADMIN_AUTH_PATTERNS.listAdmins,
        ADMIN_DASHBOARD_PATTERNS.catalog,
        ADMIN_DASHBOARD_PATTERNS.core,
        ADMIN_DASHBOARD_PATTERNS.harvest,
        ADMIN_DASHBOARD_PATTERNS.identity,
      ].sort()
    );
  });

  it('forwards the operator token and one window to every subject', async () => {
    const { svc, send } = build();

    const body = await svc.dashboard(ADMIN);

    const dashboardCalls = send.mock.calls.filter(
      ([subject]) => subject !== ADMIN_AUTH_PATTERNS.listAdmins
    );
    expect(dashboardCalls).toHaveLength(4);
    for (const [, payload] of dashboardCalls) {
      // Every service verifies the signature itself, so the token has to reach
      // all four rather than being consumed by the gateway's own guard.
      expect(payload).toEqual({
        userId: ADMIN.adminId,
        adminToken: ADMIN.token,
        window: body.window,
      });
    }
  });

  /** Section 1: a stopped service costs its own block and nothing else. */
  it('leaves one block null when its subject throws, and keeps the other three', async () => {
    const { svc } = build((subject) => {
      if (subject === ADMIN_DASHBOARD_PATTERNS.harvest) {
        throw new Error('the harvester is not deployed here');
      }
      return answerFor(subject);
    });

    const body = await svc.dashboard(ADMIN);

    expect(body.harvest).toBeNull();
    expect(body.identity).toEqual(IDENTITY);
    expect(body.core).toEqual(CORE);
    expect(body.catalog).toEqual(CATALOG);
  });

  it('still answers when every service is down', async () => {
    const { svc } = build(() => {
      throw new Error('everything is down');
    });

    const body = await svc.dashboard(ADMIN);

    expect(body.identity).toBeNull();
    expect(body.core).toBeNull();
    expect(body.catalog).toBeNull();
    expect(body.harvest).toBeNull();
    expect(body.activity).toEqual([]);
  });

  it('merges the three trails newest first', async () => {
    const { svc } = build();

    const body = await svc.dashboard(ADMIN);

    expect(body.activity.map((row) => row.at)).toEqual([
      '2026-09-06T11:00:00.000Z',
      '2026-09-06T10:30:00.000Z',
      '2026-09-06T09:00:00.000Z',
    ]);
  });

  it('names an admin actor, and renders an id the roster does not know as the id', async () => {
    const stranger = '44444444-4444-4444-8444-444444444444';
    const { svc } = build((subject) =>
      subject === ADMIN_DASHBOARD_PATTERNS.core
        ? { ...CORE, activity: [entry({ actorId: stranger })] }
        : answerFor(subject)
    );

    const body = await svc.dashboard(ADMIN);
    const named = new Map(
      body.activity.map((row) => [row.actorId, row.actorName])
    );

    expect(named.get(stranger)).toBe(stranger);
    // The display name wins over the username, per plan 0074 section 3.
    expect(named.get(ADMIN.adminId)).toBe('Daniel');
  });

  it('leaves a service actor named by its id, without asking auth about it', async () => {
    const { svc } = build();

    const body = await svc.dashboard(ADMIN);
    const service = body.activity.find((row) => row.actorKind === 'SERVICE');

    expect(service?.actorName).toBe(HARVESTER);
  });

  it('names the actors with one call, however many rows the feed has', async () => {
    const { svc, send } = build();

    await svc.dashboard(ADMIN);

    expect(
      send.mock.calls.filter(
        ([subject]) => subject === ADMIN_AUTH_PATTERNS.listAdmins
      )
    ).toHaveLength(1);
  });

  it('does not ask auth for names when no row has an admin actor', async () => {
    const { svc, send } = build((subject) => {
      if (subject === ADMIN_DASHBOARD_PATTERNS.identity) {
        return { ...IDENTITY, activity: [] };
      }
      if (subject === ADMIN_DASHBOARD_PATTERNS.core) {
        return { ...CORE, activity: [] };
      }
      return answerFor(subject);
    });

    await svc.dashboard(ADMIN);

    expect(
      send.mock.calls.some(
        ([subject]) => subject === ADMIN_AUTH_PATTERNS.listAdmins
      )
    ).toBe(false);
  });

  /**
   * A roster call that fails must not fail the page: the feed has already been
   * fetched, and "we could not label the rows" is not "the page is unavailable".
   */
  it('falls back to ids when the roster cannot be read', async () => {
    const { svc } = build((subject) => {
      if (subject === ADMIN_AUTH_PATTERNS.listAdmins) {
        throw new Error('auth is restarting');
      }
      return answerFor(subject);
    });

    const body = await svc.dashboard(ADMIN);

    expect(body.activity.every((row) => row.actorName === row.actorId)).toBe(
      true
    );
  });

  it('reports the window it asked with, thirty days ending today', async () => {
    const { svc } = build();

    const body = await svc.dashboard(ADMIN);

    expect(body.window).toEqual(dashboardWindow(new Date(body.measuredAt)));
  });
});

describe('dashboardWindow', () => {
  it('is thirty days inclusive of both ends, in UTC', () => {
    expect(dashboardWindow(new Date('2026-09-06T22:00:00.000Z'))).toEqual({
      from: '2026-08-08',
      to: '2026-09-06',
    });
  });

  it('crosses a year boundary without losing a day', () => {
    expect(dashboardWindow(new Date('2027-01-05T00:00:00.000Z'))).toEqual({
      from: '2026-12-07',
      to: '2027-01-05',
    });
  });
});

describe('mergeActivity', () => {
  it('keeps twenty rows and drops the rest', () => {
    const trail = Array.from({ length: 15 }, (_, index) =>
      entry({
        at: `2026-09-06T10:${String(index).padStart(2, '0')}:00.000Z`,
        entityId: `a${index}`,
      })
    );

    const merged = mergeActivity([trail, trail]);

    expect(merged).toHaveLength(20);
    expect(merged[0].at).toBe('2026-09-06T10:14:00.000Z');
  });

  it('breaks a tie the same way twice, so a poll does not shuffle', () => {
    const tied = [
      entry({ entity: 'zones', entityId: 'b' }),
      entry({ entity: 'zones', entityId: 'a' }),
    ];

    expect(mergeActivity([tied]).map((row) => row.entityId)).toEqual([
      'a',
      'b',
    ]);
  });
});
