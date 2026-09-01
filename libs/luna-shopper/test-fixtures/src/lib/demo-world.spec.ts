import {
  LineApprovalStatus,
  ListPermission,
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
  LINE_MILK_SET_HASH,
  LIST_FLAT_SUPPLIES_ID,
  MEMBERSHIP_CAROL_FLAT_ID,
  ZONE_FLAT_ID,
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

  it('has exactly one temporary user and one owner per zone', () => {
    const temps = auth.users.filter((u) => u.kind === UserKind.TEMPORARY);
    expect(temps).toHaveLength(1);
    for (const zone of core.zones) {
      const owners = core.memberships.filter(
        (m) => m.zoneId === zone.id && m.role === ZoneRole.OWNER
      );
      expect(owners).toHaveLength(1);
      expect(owners[0].userId).toBe(zone.ownerUserId);
    }
    expect(core.zones[0].ownerUserId).toBe(auth.users[0].id);
  });

  it('spans every approval state, both sides of zero, and a pending membership', () => {
    const approvals = new Set(core.lines.map((l) => l.approvalStatus));
    expect(approvals).toEqual(
      new Set([
        LineApprovalStatus.APPROVED,
        LineApprovalStatus.PENDING,
        LineApprovalStatus.REJECTED,
      ])
    );
    // The state a line carries since plan 0047 is its quantity, and the world
    // holds both sides of it: things the household wants, and one it is stocked
    // on at zero, which is a line nothing has deleted.
    expect(core.lines.some((l) => l.quantity === 0)).toBe(true);
    expect(core.lines.some((l) => l.quantity > 0)).toBe(true);
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

    // Every product a line stands for resolves to a catalog item id, and every
    // one of those rows belongs to a line (plan 0048, section 1.1).
    const itemIds = new Set(catalog.items.map((i) => i.id));
    for (const li of core.lineItems) {
      expect(lineIds.has(li.lineId)).toBe(true);
      expect(itemIds.has(li.itemId)).toBe(true);
    }
    expect(itemIds.has(ITEM_MILK_ID)).toBe(true);
    expect(itemIds.has(ITEM_BREAD_ID)).toBe(true);

    // Every group an item points at exists.
    const groupIds = new Set(catalog.productGroups.map((g) => g.id));
    for (const item of catalog.items) {
      if (item.productGroupId) {
        expect(groupIds.has(item.productGroupId)).toBe(true);
      }
    }

    // A line carries a hash exactly when it carries products, and null when it
    // does not. The value itself is pinned in core's `item-set-hash.spec.ts`;
    // what matters here is that the two halves cannot disagree.
    for (const line of core.lines) {
      const hasProducts = core.lineItems.some((li) => li.lineId === line.id);
      expect(line.itemSetHash === null).toBe(!hasProducts);
    }
  });

  it('gives the milk line the hash of the set it holds (plan 0048, section 1.1)', () => {
    // The written out digest, checked against the set it is supposed to be of.
    // Core's service and the core migration both compute this, in TypeScript and
    // in SQL; this is the value both are measured against.
    const milkLine = core.lines.find((l) => l.id === LINE_MILK_ID);
    expect(milkLine?.itemSetHash).toBe(LINE_MILK_SET_HASH);
    expect(
      core.lineItems
        .filter((li) => li.lineId === LINE_MILK_ID)
        .map((li) => li.itemId)
    ).toEqual([ITEM_MILK_ID]);
  });

  it('holds one write-without-decide and one decide-without-write row', () => {
    // Plan 0036, section 9. Those two are the states a single role could not
    // express, so nothing exercised them before; the demo world is where they
    // become concrete for every test that reads it.
    const sets = core.listAccess.map((a) => new Set(a.permissions));
    const writeOnly = sets.filter(
      (s) => s.has(ListPermission.WRITE) && !s.has(ListPermission.DECIDE)
    );
    const decideOnly = sets.filter(
      (s) => s.has(ListPermission.DECIDE) && !s.has(ListPermission.WRITE)
    );

    expect(writeOnly).toHaveLength(1);
    expect(decideOnly).toHaveLength(1);
  });

  it('never stores a set without READ, and never stores an empty one', () => {
    // The two invariants `setAccess` maintains (plan 0036, section 2.2). A seed
    // that broke either would be a world the service cannot produce, which is
    // the worst kind of fixture: every test against it passes and lies.
    for (const access of core.listAccess) {
      expect(access.permissions.length).toBeGreaterThan(0);
      expect(access.permissions).toContain(ListPermission.READ);
    }
  });

  it('keeps zone usernames unique within each zone', () => {
    // Per zone, because that is the scope of the name: `username` is the display
    // name inside one group and the same person carries a different one in each
    // (plan 0018). Asserting it globally would forbid the second zone reusing a
    // name it is entitled to reuse.
    for (const zone of core.zones) {
      const names = core.memberships
        .filter((m) => m.zoneId === zone.id)
        .map((m) => m.username);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('never stores an access row for a group owner or admin', () => {
    // Plan 0042, section 1.2. Such a row says nothing a staff membership does not
    // already hold by derivation, `getAccess` filters it out, and `setAccess`
    // refuses any entry naming one, so a fixture carrying one would describe a
    // world the service cannot produce and cannot be asked to change.
    const staff = new Set(
      core.memberships
        .filter((m) => m.role === ZoneRole.OWNER || m.role === ZoneRole.ADMIN)
        .map((m) => m.id)
    );
    for (const access of core.listAccess) {
      expect(staff.has(access.membershipId)).toBe(false);
    }
  });

  it('holds a member approved after the lists of a shared group existed', () => {
    // The shape plan 0042 is about (section 4). Carol is approved into the flat,
    // which has one shared list and one private one, and holds the shared set on
    // exactly the shared one: the approval grant is what wrote it, and the
    // private list is what it correctly left alone.
    const carol = core.memberships.find(
      (m) => m.id === MEMBERSHIP_CAROL_FLAT_ID
    );
    expect(carol?.status).toBe(MembershipStatus.APPROVED);

    const flatLists = core.lists.filter((l) => l.zoneId === ZONE_FLAT_ID);
    expect(flatLists.map((l) => l.sharedWithZone).sort()).toEqual([
      false,
      true,
    ]);

    const hers = core.listAccess.filter(
      (a) => a.membershipId === MEMBERSHIP_CAROL_FLAT_ID
    );
    expect(hers).toHaveLength(1);
    expect(hers[0].listId).toBe(LIST_FLAT_SUPPLIES_ID);
    expect(new Set(hers[0].permissions)).toEqual(
      new Set([
        ListPermission.READ,
        ListPermission.WRITE,
        ListPermission.DECIDE,
      ])
    );
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
