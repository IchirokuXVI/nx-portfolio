import {
  LineApprovalStatus,
  LineStatus,
  MembershipStatus,
  UserKind,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import { demoWorld } from './demo-world';
import { makeLine, makeUser } from './factories';
import {
  ALICE_ID,
  ITEM_BREAD_ID,
  ITEM_MILK_ID,
  LINE_MILK_ID,
  ZONE_WEEKLY_ID,
} from './ids';

/**
 * The demo world is the contract the seeder and the e2e specs both rely on, so
 * these guard the invariants that keep the three database halves referentially
 * consistent (plan 0013, section 1) rather than restating every field.
 */
describe('demoWorld', () => {
  const { auth, core, catalog } = demoWorld;

  it('uses the fixed id constants', () => {
    expect(auth.users.map((u) => u.id)).toContain(ALICE_ID);
    expect(core.zones[0].id).toBe(ZONE_WEEKLY_ID);
    expect(core.lines.find((l) => l.content === 'Milk')?.id).toBe(LINE_MILK_ID);
  });

  it('has exactly one temporary user and one zone owner', () => {
    const temps = auth.users.filter((u) => u.kind === UserKind.TEMPORARY);
    expect(temps).toHaveLength(1);
    const owners = core.memberships.filter((m) => m.role === ZoneRole.OWNER);
    expect(owners).toHaveLength(1);
    expect(owners[0].userId).toBe(auth.users[0].id);
    expect(owners[0].userId).toBe(core.zones[0].ownerUserId);
  });

  it('spans both line state machines and a pending membership', () => {
    const approvals = new Set(core.lines.map((l) => l.approvalStatus));
    const statuses = new Set(core.lines.map((l) => l.status));
    expect(approvals).toEqual(
      new Set([
        LineApprovalStatus.APPROVED,
        LineApprovalStatus.PENDING,
        LineApprovalStatus.REJECTED,
      ])
    );
    expect(statuses).toEqual(
      new Set([LineStatus.READY, LineStatus.PENDING, LineStatus.NOT_AVAILABLE])
    );
    expect(
      core.memberships.some((m) => m.status === MembershipStatus.PENDING)
    ).toBe(true);
  });

  it('references only ids that exist in the owning half (cross-db integrity)', () => {
    const userIds = new Set(auth.users.map((u) => u.id));
    for (const m of core.memberships) {
      expect(userIds.has(m.userId)).toBe(true);
    }
    for (const c of auth.credentials) {
      expect(userIds.has(c.userId)).toBe(true);
    }

    const zoneIds = new Set(core.zones.map((z) => z.id));
    const listIds = new Set(core.lists.map((l) => l.id));
    const membershipIds = new Set(core.memberships.map((m) => m.id));
    for (const l of core.lists) expect(zoneIds.has(l.zoneId)).toBe(true);
    for (const a of core.listAccess) {
      expect(listIds.has(a.listId)).toBe(true);
      expect(membershipIds.has(a.membershipId)).toBe(true);
    }
    const lineIds = new Set(core.lines.map((l) => l.id));
    for (const l of core.lines) expect(listIds.has(l.listId)).toBe(true);
    for (const c of core.comments) expect(lineIds.has(c.lineId)).toBe(true);

    // Every line itemId (when set) resolves to a catalog item id.
    const itemIds = new Set(catalog.items.map((i) => i.id));
    for (const l of core.lines) {
      if (l.itemId) expect(itemIds.has(l.itemId)).toBe(true);
    }
    expect(itemIds.has(ITEM_MILK_ID)).toBe(true);
    expect(itemIds.has(ITEM_BREAD_ID)).toBe(true);
  });

  it('keeps zone usernames unique', () => {
    const names = core.memberships.map((m) => m.username);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('factories', () => {
  it('default a fresh random id so one-off objects never collide', () => {
    expect(makeUser().id).not.toBe(makeUser().id);
  });

  it('apply overrides over the defaults', () => {
    const line = makeLine({ content: 'Butter', quantity: 3 });
    expect(line.content).toBe('Butter');
    expect(line.quantity).toBe(3);
    expect(line.version).toBe(1);
  });
});
