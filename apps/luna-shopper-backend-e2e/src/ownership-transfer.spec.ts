import { expect, request, test } from '@playwright/test';
import { GATEWAY_URL, REALTIME_URL } from '../playwright.config';
import { expectDocumentedShape } from './support/contract';
import { gateOnStack } from './support/db';
import { readEvents } from './support/stream';

/**
 * An ownership transfer is two role changes (plan 0029), asserted where it
 * matters: on the wire, in the zone room, against a running stack.
 *
 * The transfer always wrote both memberships correctly. What it never did was
 * say so, and the cost fell on the outgoing owner, whose client went on
 * believing it held OWNER and went on offering Delete group and Transfer
 * ownership — controls the server would then refuse. This spec fails if the
 * announcement regresses to the single `zone.ownershipChanged` it used to be.
 *
 * Event names are string literals here, as in `core-flow.spec.ts`: what a client
 * subscribes to is the wire name, and spelling it out is what makes a rename
 * visible rather than silently correct on both sides.
 *
 * Infra-gated through the shared `gateOnStack` (plan 0015, section 3.1): without
 * a stack the suite skips, and under LUNA_REQUIRE_STACK it fails instead.
 */

const ROLE_CHANGED = 'member.roleChanged';
const OWNERSHIP_CHANGED = 'zone.ownershipChanged';

interface MembershipFrame {
  id: string;
  userId: string;
  role: string;
  status: string;
}

interface ZoneFrame {
  id: string;
  ownerUserId: string | null;
}

test.describe('Luna Shopper ownership transfer', () => {
  test.beforeAll(async () => {
    await gateOnStack();
  });

  test('transfer -> both roles and the ownership arrive in the zone room', async () => {
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    // 1. Create a zone anonymously: mints a temporary owner and returns a token.
    const createRes = await ctx.post('/v1/zones', {
      data: { name: 'E2E Handover', username: 'owner' },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expectDocumentedShape('post', '/v1/zones', 201, created);
    const ownerToken: string = created.tokens.accessToken;
    const ownerUserId: string = created.data.ownerUserId;
    const zoneId: string = created.data.id;
    const joinCode: string = created.data.joinCode;

    // 2. A second identity joins with the code, and the owner approves them.
    const joinRes = await ctx.post('/v1/zones/join', {
      data: { joinCode, username: 'heir' },
    });
    expect(joinRes.ok()).toBeTruthy();
    const joined = await joinRes.json();
    expectDocumentedShape('post', '/v1/zones/join', 201, joined);
    const membershipId: string = joined.data.id;
    const heirUserId: string = joined.data.userId;

    const approveRes = await ctx.post(
      `/v1/zones/${zoneId}/members/${membershipId}/approve`,
      { headers: auth(ownerToken) }
    );
    expect(approveRes.ok()).toBeTruthy();

    // 3. Watch the zone room as the owner, who is about to stop being one. Three
    //    frames are expected, so the reader waits for three rather than for the
    //    first: the defect this covers is precisely the two that never came.
    const streamUrl = `${REALTIME_URL}/v1/zones/${zoneId}/stream`;
    const framesPromise = readEvents(
      streamUrl,
      ownerToken,
      [ROLE_CHANGED, OWNERSHIP_CHANGED],
      (frames) => frames.length >= 3,
      15_000
    );
    // Small delay so the stream subscription is established before we publish.
    await new Promise((r) => setTimeout(r, 500));

    const transferRes = await ctx.post(
      `/v1/zones/${zoneId}/members/${membershipId}/transfer-ownership`,
      { headers: auth(ownerToken) }
    );
    expect(transferRes.ok()).toBeTruthy();
    expectDocumentedShape(
      'post',
      '/v1/zones/{id}/members/{membershipId}/transfer-ownership',
      201,
      await transferRes.json()
    );

    const frames = await framesPromise;
    expect(frames.map((frame) => frame.event)).toEqual([
      ROLE_CHANGED,
      ROLE_CHANGED,
      OWNERSHIP_CHANGED,
    ]);

    // The outgoing owner first, demoted to admin, then the heir. Roles ahead of
    // the ownership event so a client applying them in order never has a frame
    // where `ownerUserId` names somebody whose role still says otherwise.
    expect(frames[0].payload as MembershipFrame).toMatchObject({
      userId: ownerUserId,
      role: 'ADMIN',
      status: 'APPROVED',
    });
    expect(frames[1].payload as MembershipFrame).toMatchObject({
      id: membershipId,
      userId: heirUserId,
      role: 'OWNER',
      status: 'APPROVED',
    });
    expect(frames[2].payload as ZoneFrame).toMatchObject({
      id: zoneId,
      ownerUserId: heirUserId,
    });

    // 4. And the demotion is real, not only announced: the endpoint the stale
    //    screen would still have offered now refuses the former owner.
    const refusedRes = await ctx.delete(`/v1/zones/${zoneId}`, {
      headers: auth(ownerToken),
    });
    expect(refusedRes.status()).toBe(403);

    await ctx.dispose();
  });
});
