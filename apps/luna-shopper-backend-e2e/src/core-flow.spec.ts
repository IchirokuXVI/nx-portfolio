import { expect, request, test } from '@playwright/test';
import { GATEWAY_URL, REALTIME_URL } from '../playwright.config';
import { expectDocumentedShape } from './support/contract';
import { gateOnStack } from './support/db';
import { waitForEvent } from './support/stream';

/**
 * The core collaborative flow end to end (plan 0010, section 1), against the
 * gateway's public REST surface and the realtime SSE channel — never a service's
 * internal port: create a zone and get a token, join and get approved, create a
 * list, add a line, and see the realtime `line.added` event arrive.
 *
 * Every response is additionally checked against the schema the published
 * OpenAPI document promises for that route (plan 0019, section 5), so this suite
 * asserts the contract and not merely the status: the docs describe the schema,
 * the schema is the one the services validate their broker messages against, and
 * these assertions run it against the real server.
 *
 * Infra-gated through the shared `gateOnStack` (plan 0015, section 3.1): if the
 * gateway is not reachable the whole suite skips, so it is a clean green no-op
 * without `docker compose up` + the services — and under LUNA_REQUIRE_STACK the
 * same condition fails instead, because CI stood the stack up on purpose. This
 * file used to carry its own copy of the probe; the one definition now lives in
 * `support/db.ts`. The SSE reader went the same way: it lives in
 * `support/stream.ts` now, because plan 0029's spec waits on three events and
 * one parser for the transport is enough.
 */

test.describe('Luna Shopper core flow', () => {
  test.beforeAll(async () => {
    await gateOnStack();
  });

  test('zone -> token -> approve -> list -> line -> realtime line.added', async () => {
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    // 1. Create a zone anonymously: mints a temporary owner and returns a token.
    const createRes = await ctx.post('/v1/zones', {
      data: { name: 'E2E Zone', username: 'owner' },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expectDocumentedShape('post', '/v1/zones', 201, created);
    const ownerToken: string = created.tokens.accessToken;
    const zoneId: string = created.data.id;
    const joinCode: string = created.data.joinCode;
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    // 2. A second identity joins with the code (lands PENDING, gets its token).
    const joinRes = await ctx.post('/v1/zones/join', {
      data: { joinCode, username: 'member' },
    });
    expect(joinRes.ok()).toBeTruthy();
    const joined = await joinRes.json();
    expectDocumentedShape('post', '/v1/zones/join', 201, joined);
    const membershipId: string = joined.data.id;

    // 3. The owner approves the pending member.
    const approveRes = await ctx.post(
      `/v1/zones/${zoneId}/members/${membershipId}/approve`,
      { headers: auth(ownerToken) }
    );
    expect(approveRes.ok()).toBeTruthy();
    expectDocumentedShape(
      'post',
      '/v1/zones/{id}/members/{membershipId}/approve',
      201,
      await approveRes.json()
    );

    // 4. The owner creates a list in the zone.
    const listRes = await ctx.post(`/v1/zones/${zoneId}/lists`, {
      headers: auth(ownerToken),
      data: { name: 'Groceries' },
    });
    expect(listRes.ok()).toBeTruthy();
    const list = await listRes.json();
    expectDocumentedShape('post', '/v1/zones/{zoneId}/lists', 201, list);
    const listId: string = list.id;

    // 5. Open the realtime SSE stream for the zone, then add a line and assert
    //    the `line.added` event arrives and satisfies the published contract.
    const streamUrl = `${REALTIME_URL}/v1/zones/${zoneId}/stream`;
    const eventPromise = waitForEvent(
      streamUrl,
      ownerToken,
      'line.added',
      10_000
    );
    // Small delay so the stream subscription is established before we publish.
    await new Promise((r) => setTimeout(r, 500));

    const addLineRes = await ctx.post(`/v1/lists/${listId}/lines`, {
      headers: auth(ownerToken),
      data: { content: 'Milk', quantity: 2 },
    });
    expect(addLineRes.ok()).toBeTruthy();
    expectDocumentedShape(
      'post',
      '/v1/lists/{id}/lines',
      201,
      await addLineRes.json()
    );

    // The frame carries the line itself, which is what a client renders. The
    // DomainEvent envelope that `validateEvent` describes is the JetStream hop's
    // shape and never reaches a client, so assert the payload the SSE surface
    // actually publishes.
    const event = (await eventPromise) as Record<string, unknown>;
    expect(event).toMatchObject({
      listId,
      content: 'Milk',
      quantity: 2,
    });
    expect(typeof event['id']).toBe('string');

    await ctx.dispose();
  });
});
