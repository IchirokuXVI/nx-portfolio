import { expect, request, test } from '@playwright/test';
import {
  DEMO_PASSWORD,
  LINE_MILK_ID,
  LIST_GROCERIES_ID,
  LIST_HARDWARE_ID,
  ZONE_WEEKLY_ID,
} from '@portfolio/luna-shopper/test-fixtures';
import { GATEWAY_URL } from '../playwright.config';
import { expectDocumentedShape } from './support/contract';
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
    const tokens = await loginRes.json();
    expectDocumentedShape('post', '/v1/auth/login', 201, tokens);
    const token: string = tokens.accessToken;
    const auth = { Authorization: `Bearer ${token}` };

    // 2. The seeded zone has exactly the two seeded lists, by fixed id and name.
    const listsRes = await ctx.get(`/v1/zones/${ZONE_WEEKLY_ID}/lists`, {
      headers: auth,
    });
    expect(listsRes.ok()).toBeTruthy();
    const listsBody = await listsRes.json();
    // The page envelope itself is part of the contract, so validate before the
    // `rows` helper unwraps it (plan 0019, section 4).
    expectDocumentedShape('get', '/v1/zones/{zoneId}/lists', 200, listsBody);
    const lists = rows(listsBody);
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
    const linesBody = await linesRes.json();
    expectDocumentedShape('get', '/v1/lists/{id}/lines', 200, linesBody);
    const lines = rows<{ id: string; content?: string }>(linesBody);
    const milk = lines.find((l) => l.id === LINE_MILK_ID);
    expect(milk?.content).toBe('Milk');

    await ctx.dispose();
  });
});
