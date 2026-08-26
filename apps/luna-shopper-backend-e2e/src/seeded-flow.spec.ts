import { expect, request, test } from '@playwright/test';
import {
  DEMO_PASSWORD,
  LINE_MILK_ID,
  LIST_GROCERIES_ID,
  LIST_HARDWARE_ID,
  ZONE_WEEKLY_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import { GATEWAY_URL } from '../playwright.config';
import { gateOnStack } from './support/db';

/**
 * Navigation over the SEEDED demo world using the shared fixed ids (plan 0013,
 * section 4). It logs in as the seeded owner (Alice, email + password) through
 * the gateway and reads back the zone and list the fixtures library says should
 * be there, proving the seeder and the fixtures agree.
 *
 * Gated on E2E_SEED (global-setup only seeds then) AND a reachable gateway, so a
 * default run without seeding is a clean skip. Under LUNA_REQUIRE_STACK the same
 * gate fails instead of skipping (plan 0015, section 3.2).
 */

/**
 * Rows out of a gateway collection response, which is a cursor page shaped
 * `{ items: [...], nextCursor }`. A bare array is still accepted so an
 * unpaginated endpoint reads the same way.
 */
/** A zone as the home screen reads it (plan 0017, sections 3 and 7). */
interface SummaryZone {
  id: string;
  updatedAt: string;
  counts: {
    memberCount: number;
    listCount: number;
    pendingRequestCount: number | null;
    firstPendingRequesterName: string | null;
  };
  lists: { id: string; name: string; lineCount: number; readyCount: number }[];
}

function rows<T = { id: string; name?: string }>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const items = (body as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

test.describe('Luna Shopper seeded demo world', () => {
  test.beforeAll(async () => {
    await gateOnStack({ seeded: true });
  });

  test('log in as the seeded owner and read the seeded zone and list', async () => {
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    // 1. Log in as Alice with the seeded email + password credential.
    const loginRes = await ctx.post('/v1/auth/login', {
      data: { email: 'alice@example.com', password: DEMO_PASSWORD },
    });
    expect(loginRes.ok()).toBeTruthy();
    const token: string = (await loginRes.json()).accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    // 2. The seeded zone has exactly the two seeded lists, by fixed id and name.
    const listsRes = await ctx.get(`/v1/zones/${ZONE_WEEKLY_ID}/lists`, {
      headers: auth,
    });
    expect(listsRes.ok()).toBeTruthy();
    const lists = rows(await listsRes.json());
    const listIds = lists.map((l) => l.id);
    expect(listIds).toContain(LIST_GROCERIES_ID);
    expect(listIds).toContain(LIST_HARDWARE_ID);
    expect(lists.find((l) => l.id === LIST_GROCERIES_ID)?.name).toBe(
      'Groceries'
    );

    // 3. The groceries list contains the seeded milk line, by fixed id.
    const linesRes = await ctx.get(`/v1/lists/${LIST_GROCERIES_ID}/lines`, {
      headers: auth,
    });
    expect(linesRes.ok()).toBeTruthy();
    const lines = rows<{ id: string; content?: string }>(await linesRes.json());
    const milk = lines.find((l) => l.id === LINE_MILK_ID);
    expect(milk?.content).toBe('Milk');

    await ctx.dispose();
  });

  /**
   * The exit criterion of plan 0017: every number the approved home screen draws
   * comes back from a single `GET /v1/zones`, over the real gateway, against the
   * seeded world.
   */
  test('renders the whole home screen from one GET /v1/zones', async () => {
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    const loginRes = await ctx.post('/v1/auth/login', {
      data: { email: 'alice@example.com', password: DEMO_PASSWORD },
    });
    expect(loginRes.ok()).toBeTruthy();
    const auth = {
      Authorization: `Bearer ${(await loginRes.json()).accessToken}`,
    };

    const zonesRes = await ctx.get('/v1/zones', { headers: auth });
    expect(zonesRes.ok()).toBeTruthy();
    const zones = rows<SummaryZone>(await zonesRes.json());
    const weekly = zones.find((z) => z.id === ZONE_WEEKLY_ID);
    expect(weekly).toBeDefined();

    // "3 members", "2 lists".
    expect(weekly?.counts.memberCount).toBeGreaterThan(0);
    expect(weekly?.counts.listCount).toBe(weekly?.lists.length);
    // "Ines and 2 more want to join": Alice owns the zone, so she sees it.
    expect(weekly?.counts.pendingRequestCount).not.toBeNull();
    // "12 items", "7 of 12 ready".
    const groceries = weekly?.lists.find((l) => l.id === LIST_GROCERIES_ID);
    expect(groceries?.name).toBe('Groceries');
    expect(groceries?.lineCount).toBeGreaterThan(0);
    expect(groceries?.readyCount).toBeLessThanOrEqual(
      groceries?.lineCount ?? 0
    );
    // Section 7: a sortable field is now a readable one.
    expect(weekly?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // The same zone, fetched on its own, agrees with the listing.
    const oneRes = await ctx.get(`/v1/zones/${ZONE_WEEKLY_ID}`, {
      headers: auth,
    });
    expect(oneRes.ok()).toBeTruthy();
    const one: SummaryZone = await oneRes.json();
    expect(one.counts).toEqual(weekly?.counts);

    // The member read surface the zone controller never had.
    const membersRes = await ctx.get(`/v1/zones/${ZONE_WEEKLY_ID}/members`, {
      headers: auth,
    });
    expect(membersRes.ok()).toBeTruthy();
    expect(rows(await membersRes.json()).length).toBe(
      weekly?.counts.memberCount
    );

    // `count` is routed before `:id`, or it would be read as a zone id.
    const countRes = await ctx.get('/v1/zones/count', { headers: auth });
    expect(countRes.ok()).toBeTruthy();
    const counts = await countRes.json();
    expect(counts.total).toBe(counts.owned + counts.joined);

    await ctx.dispose();
  });

  test('serves the platform totals without a token', async () => {
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    // The only public read in the API (plan 0017, section 8.2).
    const res = await ctx.get('/v1/stats');

    expect(res.ok()).toBeTruthy();
    const stats = await res.json();
    expect(stats.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stats.identity.registeredUsers).toBeGreaterThan(0);
    expect(stats.core.activeZones).toBeGreaterThan(0);

    await ctx.dispose();
  });
});
