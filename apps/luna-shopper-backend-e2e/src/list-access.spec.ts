import { expect, request, test } from '@playwright/test';
import { GATEWAY_URL } from '../playwright.config';
import { expectDocumentedShape } from './support/contract';
import { gateOnStack } from './support/db';

/**
 * The share sheet's save, through the gateway (plan 0042, section 5).
 *
 * **This is the test the plan exists to turn green.** Every group has an owner,
 * the owner is who creates the first list in it, and creation used to write the
 * creator's own access row whoever they were. So a staff row was in the access
 * table of essentially every list, `GET /access` returned it because the read had
 * no filter, and `PUT /access` refused it because rule 2 rejects any entry naming
 * a zone OWNER or ADMIN. The three pieces were each defensible and together they
 * were a feature that had never worked for anybody.
 *
 * The second test is the other report: a list shared with a group must be
 * visible to somebody who joins afterwards. That was impossible to fix on the
 * client, because sharing was an action taken once at creation and no state
 * anywhere recorded it.
 *
 * Infra-gated through the shared `gateOnStack` (plan 0015, section 3.1): without
 * a stack the suite skips, and under LUNA_REQUIRE_STACK it fails instead.
 */

interface AccessEntry {
  membershipId: string;
  permissions: string[];
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Luna Shopper list access', () => {
  test.beforeAll(async () => {
    await gateOnStack();
  });

  test('an owner can change a member permissions and save', async () => {
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    // 1. A group, its owner, and a second person approved into it.
    const created = await (
      await ctx.post('/v1/zones', {
        data: { name: 'E2E Share', username: 'owner' },
      })
    ).json();
    const ownerToken: string = created.tokens.accessToken;
    const zoneId: string = created.data.id;
    const joinCode: string = created.data.joinCode;

    const joined = await (
      await ctx.post('/v1/zones/join', { data: { joinCode, username: 'mate' } })
    ).json();
    const membershipId: string = joined.data.id;
    const approveRes = await ctx.post(
      `/v1/zones/${zoneId}/members/${membershipId}/approve`,
      { headers: auth(ownerToken) }
    );
    expect(approveRes.ok()).toBeTruthy();

    // 2. The owner makes a list, which is the step that used to poison the table.
    const listRes = await ctx.post(`/v1/zones/${zoneId}/lists`, {
      headers: auth(ownerToken),
      data: { name: 'Weekly shop' },
    });
    expect(listRes.ok()).toBeTruthy();
    const list = await listRes.json();
    expectDocumentedShape('post', '/v1/zones/{zoneId}/lists', 201, list);
    const listId: string = list.data.id;

    // 3. The read returns no entry naming the owner, so a client that echoes it
    //    back has nothing rule 2 can refuse.
    const readRes = await ctx.get(`/v1/lists/${listId}/access`, {
      headers: auth(ownerToken),
    });
    expect(readRes.ok()).toBeTruthy();
    const view = await readRes.json();
    expectDocumentedShape('get', '/v1/lists/{id}/access', 200, view);
    const entries: AccessEntry[] = view.data.entries;
    expect(entries.map((e) => e.membershipId)).toEqual([membershipId]);

    // 4. The save itself, sending back everything the sheet was given. It is a
    //    403 before this plan, on the owner's own row, and nothing is written.
    const saveRes = await ctx.put(`/v1/lists/${listId}/access`, {
      headers: auth(ownerToken),
      data: {
        entries: [{ membershipId, permissions: ['READ', 'WRITE'] }],
      },
    });
    expect(saveRes.status()).toBe(200);

    // 5. And it survives a reopen, which is what somebody pressing Save meant.
    const reread = await (
      await ctx.get(`/v1/lists/${listId}/access`, { headers: auth(ownerToken) })
    ).json();
    const saved: AccessEntry[] = reread.data.entries;
    expect(saved).toHaveLength(1);
    expect(saved[0].membershipId).toBe(membershipId);
    expect([...saved[0].permissions].sort()).toEqual(['READ', 'WRITE']);

    await ctx.dispose();
  });

  test('a member who joins later sees the shared lists and not the private one', async () => {
    const ctx = await request.newContext({ baseURL: GATEWAY_URL });

    const created = await (
      await ctx.post('/v1/zones', {
        data: { name: 'E2E Late Joiner', username: 'owner' },
      })
    ).json();
    const ownerToken: string = created.tokens.accessToken;
    const zoneId: string = created.data.id;
    const joinCode: string = created.data.joinCode;

    // Both lists exist BEFORE anybody else is anywhere near the group, which is
    // the ordinary way a household sets this up and the shape that used to
    // produce a member who could see nothing at all.
    const shared = await (
      await ctx.post(`/v1/zones/${zoneId}/lists`, {
        headers: auth(ownerToken),
        data: { name: 'Groceries', shareWithZone: true },
      })
    ).json();
    expect(shared.data.sharedWithZone).toBe(true);

    const priv = await (
      await ctx.post(`/v1/zones/${zoneId}/lists`, {
        headers: auth(ownerToken),
        data: { name: 'Gift ideas', shareWithZone: false },
      })
    ).json();
    expect(priv.data.sharedWithZone).toBe(false);

    const joined = await (
      await ctx.post('/v1/zones/join', { data: { joinCode, username: 'mate' } })
    ).json();
    const mateToken: string = joined.tokens.accessToken;
    const membershipId: string = joined.data.id;
    await ctx.post(`/v1/zones/${zoneId}/members/${membershipId}/approve`, {
      headers: auth(ownerToken),
    });

    const mineRes = await ctx.get(`/v1/zones/${zoneId}/lists`, {
      headers: auth(mateToken),
    });
    expect(mineRes.ok()).toBeTruthy();
    const mine = await mineRes.json();
    expect(mine.data.items.map((l: { name: string }) => l.name)).toEqual([
      'Groceries',
    ]);

    // And flipping the private one open reaches them too, without anybody
    // ticking four boxes per person.
    const openRes = await ctx.patch(`/v1/lists/${priv.data.id}`, {
      headers: auth(ownerToken),
      data: { sharedWithZone: true },
    });
    expect(openRes.ok()).toBeTruthy();
    expect((await openRes.json()).data.sharedWithZone).toBe(true);

    const after = await (
      await ctx.get(`/v1/zones/${zoneId}/lists`, { headers: auth(mateToken) })
    ).json();
    expect(
      after.data.items.map((l: { name: string }) => l.name).sort()
    ).toEqual(['Gift ideas', 'Groceries']);

    // Turning it off revokes nobody: the switch is about who arrives next.
    await ctx.patch(`/v1/lists/${priv.data.id}`, {
      headers: auth(ownerToken),
      data: { sharedWithZone: false },
    });
    const stillThere = await (
      await ctx.get(`/v1/zones/${zoneId}/lists`, { headers: auth(mateToken) })
    ).json();
    expect(
      stillThere.data.items.map((l: { name: string }) => l.name).sort()
    ).toEqual(['Gift ideas', 'Groceries']);

    await ctx.dispose();
  });
});
