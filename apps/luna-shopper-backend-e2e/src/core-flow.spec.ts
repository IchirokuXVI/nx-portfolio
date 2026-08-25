import { expect, request, test } from '@playwright/test';
import { GATEWAY_URL, REALTIME_URL } from '../playwright.config';
import { gateOnStack } from './support/db';

/**
 * The core collaborative flow end to end (plan 0010, section 1), against the
 * gateway's public REST surface and the realtime SSE channel — never a service's
 * internal port: create a zone and get a token, join and get approved, create a
 * list, add a line, and see the realtime `line.added` event arrive.
 *
 * Infra-gated through the shared `gateOnStack` (plan 0015, section 3.1): if the
 * gateway is not reachable the whole suite skips, so it is a clean green no-op
 * without `docker compose up` + the services — and under LUNA_REQUIRE_STACK the
 * same condition fails instead, because CI stood the stack up on purpose. This
 * file used to carry its own copy of the probe; the one definition now lives in
 * `support/db.ts`.
 */

/**
 * Read the SSE stream until a `line.added` event arrives or the timeout fires.
 *
 * An SSE frame names its event on its own `event:` line and carries only the
 * payload on `data:` — the same split the socket transport makes, where the
 * event name is the channel and the payload is the body (plan 0009, section 3:
 * both transports publish identical payloads). The DomainEvent envelope stays
 * internal to the JetStream hop, so the event name is read off the frame rather
 * than looked for inside the JSON.
 */
async function waitForLineAdded(
  streamUrl: string,
  token: string,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(streamUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!res.body) {
      throw new Error('stream had no body');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; each `data:` line holds JSON.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        let name: string | undefined;
        let json = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) {
            name = line.slice('event:'.length).trim();
          } else if (line.startsWith('data:')) {
            json += line.slice('data:'.length).trim();
          }
        }
        if (name === 'line.added' && json) {
          return JSON.parse(json);
        }
      }
    }
    throw new Error('stream ended before line.added arrived');
  } finally {
    clearTimeout(timer);
  }
}

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
    const membershipId: string = joined.data.id;

    // 3. The owner approves the pending member.
    const approveRes = await ctx.post(
      `/v1/zones/${zoneId}/members/${membershipId}/approve`,
      { headers: auth(ownerToken) }
    );
    expect(approveRes.ok()).toBeTruthy();

    // 4. The owner creates a list in the zone.
    const listRes = await ctx.post(`/v1/zones/${zoneId}/lists`, {
      headers: auth(ownerToken),
      data: { name: 'Groceries' },
    });
    expect(listRes.ok()).toBeTruthy();
    const listId: string = (await listRes.json()).id;

    // 5. Open the realtime SSE stream for the zone, then add a line and assert
    //    the `line.added` event arrives and satisfies the published contract.
    const streamUrl = `${REALTIME_URL}/v1/zones/${zoneId}/stream`;
    const eventPromise = waitForLineAdded(streamUrl, ownerToken, 10_000);
    // Small delay so the stream subscription is established before we publish.
    await new Promise((r) => setTimeout(r, 500));

    const addLineRes = await ctx.post(`/v1/lists/${listId}/lines`, {
      headers: auth(ownerToken),
      data: { content: 'Milk', quantity: 2 },
    });
    expect(addLineRes.ok()).toBeTruthy();

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
