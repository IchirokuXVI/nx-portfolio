import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import { LineMemory } from '../lines/line-memory';
import { MembershipMemory } from '../memberships/membership-memory';
import { ZoneMemory } from '../zones/zone-memory';
import { ListMemory } from './list-memory';

/**
 * The four permission states, exercised where they are cheap (plan 0030, section 9).
 *
 * Against a real gateway each of these needs four accounts, a group and a share sheet.
 * Here each is a seeded access row, which is the entire argument for making the fake
 * **enforce** permissions rather than only store them. Two of the states, a `WRITE`-only
 * caller and a `DECIDE`-only caller, had never been rendered by anything before this
 * plan, so they are the ones with the most to say.
 *
 * The seeded caller owns `zone-flat` and is an ordinary member of `zone-parents`, which
 * is why every interesting list below is in the second one: staff hold all four on every
 * list in their zone by derivation, so a group they own can only ever show one state.
 */
async function build(): Promise<{ lists: ListMemory; lines: LineMemory }> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideHttpClient(),
      ApiUrl,
      TokenStore,
      ZoneMemory,
      MembershipMemory,
      ListMemory,
      LineMemory,
    ],
  }).compileComponents();

  return {
    lists: TestBed.inject(ListMemory),
    lines: TestBed.inject(LineMemory),
  };
}

/** The code a rejected call answered with, so a spec asserts on the code not the text. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return 'no-failure';
  } catch (error) {
    return error instanceof GatewayError ? error.code : 'not-a-gateway-error';
  }
}

/** One list per permission state. `SEED_LIST_ACCESS` explains which is which. */
const OWNED_LIST = 'list-weekly';
const READ_ONLY = 'list-sunday';
const WRITE_ONLY = 'list-pantry';
const DECIDE_ONLY = 'list-market';
const LIST_ADMIN = 'list-freezer';

const MEMBER_ZONE = 'zone-parents';

describe('ListMemory as a permission model', () => {
  describe('permissionsFor', () => {
    it('gives group staff all four, without a stored row', async () => {
      // Derived at check time and never written, so a promotion is instantly correct
      // everywhere (backend plan 0036, section 2.4).
      const { lists } = await build();

      expect([...lists.permissionsFor(OWNED_LIST)].sort()).toEqual([
        'DECIDE',
        'MANAGE',
        'READ',
        'WRITE',
      ]);
    });

    it('gives an ordinary member exactly their row', async () => {
      const { lists } = await build();

      expect(lists.permissionsFor(READ_ONLY)).toEqual(['READ']);
      expect(lists.permissionsFor(WRITE_ONLY)).toEqual(['READ', 'WRITE']);
      expect(lists.permissionsFor(DECIDE_ONLY)).toEqual(['READ', 'DECIDE']);
    });

    it('answers the empty set for a list it does not know', async () => {
      // A question, not a check: the checks are the ones that raise `not_found`.
      const { lists } = await build();

      expect(lists.permissionsFor('list-nowhere')).toEqual([]);
    });
  });

  describe('what MANAGE gates', () => {
    it('refuses a rename without it', async () => {
      const { lists } = await build();

      expect(await codeOf(lists.updateList(WRITE_ONLY, { name: 'x' }))).toBe(
        'forbidden'
      );
    });

    it('refuses reading the access table without it', async () => {
      // Who else can write to a list is governance, not content, so READ does not
      // include it (backend plan 0036, section 4.3).
      const { lists } = await build();

      expect(await codeOf(lists.getListAccess(READ_ONLY))).toBe('forbidden');
    });

    it('allows both for a list admin who is not group staff', async () => {
      const { lists } = await build();

      const updated = await lists.updateList(LIST_ADMIN, {
        autoApproveLines: true,
      });

      expect(updated.autoApproveLines).toBe(true);
      expect(await lists.getListAccess(LIST_ADMIN)).not.toHaveLength(0);
    });
  });

  describe('setListAccess, and who may grant what', () => {
    it('leaves a membership the payload does not name alone', async () => {
      // Not a whole-table replace, which is what it used to be: each entry states the
      // whole answer for that membership and nothing else (backend plan 0036, 5.2).
      const { lists } = await build();

      await lists.setListAccess(LIST_ADMIN, [
        { membershipId: 'm-parents-rosa', permissions: ['READ'] },
      ]);

      const entries = await lists.getListAccess(LIST_ADMIN);
      expect(
        entries.find((row) => row.membershipId === 'm-parents-me')?.permissions
      ).toEqual(['READ', 'WRITE', 'DECIDE', 'MANAGE']);
    });

    it('adds READ to any non-empty set it is given', async () => {
      const { lists } = await build();

      await lists.setListAccess(LIST_ADMIN, [
        { membershipId: 'm-parents-rosa', permissions: ['WRITE'] },
      ]);

      const entries = await lists.getListAccess(LIST_ADMIN);
      expect(
        entries.find((row) => row.membershipId === 'm-parents-rosa')
          ?.permissions
      ).toEqual(['READ', 'WRITE']);
    });

    it('deletes the row for an empty set, which is how access is revoked', async () => {
      const { lists } = await build();

      await lists.setListAccess(LIST_ADMIN, [
        { membershipId: 'm-parents-rosa', permissions: [] },
      ]);

      const entries = await lists.getListAccess(LIST_ADMIN);
      expect(entries.map((row) => row.membershipId)).toEqual(['m-parents-me']);
    });

    it('refuses an entry naming group staff, even from a staff caller', async () => {
      // Refused rather than dropped, so the caller is told rather than left believing
      // they did something. The row would be meaningless either way.
      const { lists } = await build();

      expect(
        await codeOf(
          lists.setListAccess(OWNED_LIST, [
            { membershipId: 'm-flat-toni', permissions: ['READ'] },
          ])
        )
      ).toBe('validation_failed');
    });

    it('refuses a MANAGE change made by a list admin who is not group staff', async () => {
      // A permission that can grant itself has no ceiling, so the bit stays the
      // group's (backend plan 0036, section 5.1).
      const { lists } = await build();

      expect(
        await codeOf(
          lists.setListAccess(LIST_ADMIN, [
            {
              membershipId: 'm-parents-rosa',
              permissions: ['READ', 'MANAGE'],
            },
          ])
        )
      ).toBe('forbidden');
    });

    it('refuses that caller clearing a row that holds MANAGE', async () => {
      // The interaction rule 5 would hide if the rules ran in the other order: clearing
      // a row that holds MANAGE is a MANAGE change.
      const { lists } = await build();
      await lists.setAccessFixture(LIST_ADMIN, [
        {
          membershipId: 'm-parents-me',
          permissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
        },
        {
          membershipId: 'm-parents-rosa',
          permissions: ['READ', 'MANAGE'],
        },
      ]);

      expect(
        await codeOf(
          lists.setListAccess(LIST_ADMIN, [
            { membershipId: 'm-parents-rosa', permissions: [] },
          ])
        )
      ).toBe('forbidden');
    });

    it('lets a group admin move the MANAGE bit', async () => {
      const { lists } = await build();

      await lists.setListAccess(OWNED_LIST, [
        { membershipId: 'm-flat-marta', permissions: ['MANAGE'] },
      ]);

      // A list admin has all the other permissions, so the mock stores what the
      // server would (backend plan 0036, section 2.2).
      const entries = await lists.getListAccess(OWNED_LIST);
      expect(
        entries.find((row) => row.membershipId === 'm-flat-marta')?.permissions
      ).toEqual(['READ', 'WRITE', 'DECIDE', 'MANAGE']);
    });
  });

  describe('creating a list writes the access it granted', () => {
    it('gives the creator all four and the group the other three', async () => {
      const { lists } = await build();

      const created = await lists.createList(MEMBER_ZONE, 'Picnic', true);
      const entries = await lists.getListAccess(created.id);

      expect(created.myPermissions).toEqual([
        'READ',
        'WRITE',
        'DECIDE',
        'MANAGE',
      ]);
      expect(
        entries.find((row) => row.membershipId === 'm-parents-rosa')
          ?.permissions
      ).toEqual(['READ', 'WRITE', 'DECIDE']);
      // Staff need no row: Mum and Dad hold everything by derivation.
      expect(entries.map((row) => row.membershipId).sort()).toEqual([
        'm-parents-me',
        'm-parents-rosa',
      ]);
    });

    it('keeps a private list to its creator', async () => {
      const { lists } = await build();

      const created = await lists.createList(MEMBER_ZONE, 'Secret', false);
      const entries = await lists.getListAccess(created.id);

      expect(entries.map((row) => row.membershipId)).toEqual(['m-parents-me']);
    });
  });

  describe('the caller sees their own permissions on every list it serves', () => {
    it('stamps myPermissions rather than reading it from the fixture', async () => {
      const { lists } = await build();

      const page = await lists.listLists(MEMBER_ZONE);
      const byId = new Map(
        page.items.map((row) => [row.id, row.myPermissions])
      );

      expect(byId.get(READ_ONLY)).toEqual(['READ']);
      expect(byId.get(WRITE_ONLY)).toEqual(['READ', 'WRITE']);
      expect(byId.get(DECIDE_ONLY)).toEqual(['READ', 'DECIDE']);
    });

    it('drops a list the caller has been revoked from', async () => {
      const { lists } = await build();
      await lists.setAccessFixture(READ_ONLY, []);

      const page = await lists.listLists(MEMBER_ZONE);

      expect(page.items.map((row) => row.id)).not.toContain(READ_ONLY);
    });
  });
});

describe('LineMemory refuses what the server would refuse', () => {
  describe('a WRITE-only caller', () => {
    it('may add a line', async () => {
      const { lines } = await build();

      const line = await lines.addLine(WRITE_ONLY, 'Chorizo', 1);

      expect(line.content).toBe('Chorizo');
    });

    it('may not tick one off, which is DECIDE now', async () => {
      const { lines } = await build();

      expect(await codeOf(lines.setStatus('ln-p-01', 'READY'))).toBe(
        'forbidden'
      );
    });

    it('may not approve anything', async () => {
      const { lines } = await build();

      expect(await codeOf(lines.setApproval('ln-p-03', 'APPROVED'))).toBe(
        'forbidden'
      );
    });

    it('may edit an unapproved line and not an approved one', async () => {
      const { lines } = await build();

      const edited = await lines.updateLine('ln-p-03', { quantity: 6 });
      expect(edited.quantity).toBe(6);

      expect(await codeOf(lines.updateLine('ln-p-02', { quantity: 2 }))).toBe(
        'forbidden'
      );
    });

    it('puts a rejected line back to PENDING when it is edited', async () => {
      // What makes a rejection a conversation rather than a dead end (backend plan
      // 0036, section 4.2). It happens on any edit, including a quantity-only one.
      const { lines } = await build();

      const edited = await lines.updateLine('ln-p-04', { quantity: 2 });

      expect(edited.approvalStatus).toBe('PENDING');
      expect(edited.approvedByUserId).toBeNull();
    });

    it('gets an APPROVED line with no approver on an auto-approving list', async () => {
      // Rule 2 of backend plan 0037 section 2, reachable on its own only here: this
      // caller cannot decide, and the list is configured not to ask.
      const { lines } = await build();

      const line = await lines.addLine(WRITE_ONLY, 'Paprika', 1);

      expect(line.approvalStatus).toBe('APPROVED');
      expect(line.approvedByUserId).toBeNull();
    });
  });

  describe('a DECIDE-only caller', () => {
    it('may not add a line', async () => {
      const { lines } = await build();

      expect(await codeOf(lines.addLine(DECIDE_ONLY, 'Chorizo', 1))).toBe(
        'forbidden'
      );
    });

    it('may tick one off, approve, and turn one down', async () => {
      const { lines } = await build();

      expect((await lines.setStatus('ln-m-02', 'READY')).status).toBe('READY');
      expect(
        (await lines.setApproval('ln-m-03', 'APPROVED')).approvalStatus
      ).toBe('APPROVED');
      expect(
        (await lines.setApproval('ln-m-03', 'REJECTED')).approvalStatus
      ).toBe('REJECTED');
    });

    it('may change an approved line’s quantity and nothing else about it', async () => {
      const { lines } = await build();

      expect(
        (await lines.updateLine('ln-m-01', { quantity: 4 })).quantity
      ).toBe(4);
      expect(
        await codeOf(lines.updateLine('ln-m-01', { content: 'Passata' }))
      ).toBe('forbidden');
    });

    it('may not edit an unapproved line at all, having no WRITE', async () => {
      const { lines } = await build();

      expect(await codeOf(lines.updateLine('ln-m-03', { quantity: 2 }))).toBe(
        'forbidden'
      );
    });

    it('leaves the remainder behind when it lowers an approved quantity', async () => {
      // Backend plan 0037 section 4: the quantity a list asked for is not lost when a
      // shopper comes back with less. The remainder is the original author's request,
      // so it keeps their name, and it sits directly below rather than at the end.
      const { lines } = await build();

      await lines.updateLine('ln-m-01', { quantity: 1 });
      const page = await lines.listLines(DECIDE_ONLY);
      const ids = page.items.map((row) => row.id);
      const remainder = page.items[ids.indexOf('ln-m-01') + 1];

      expect(remainder.content).toBe('Tinned tomatoes');
      expect(remainder.quantity).toBe(2);
      expect(remainder.approvalStatus).toBe('APPROVED');
      expect(remainder.status).toBe('NOT_AVAILABLE');
      expect(remainder.createdByUserId).toBe('user-dad');
    });

    it('does not split when the quantity went up', async () => {
      const { lines } = await build();

      await lines.updateLine('ln-m-01', { quantity: 5 });
      const page = await lines.listLines(DECIDE_ONLY);

      expect(page.items).toHaveLength(4);
    });

    it('refuses a quantity of zero, which is what NOT_AVAILABLE is for', async () => {
      const { lines } = await build();

      expect(await codeOf(lines.updateLine('ln-m-01', { quantity: 0 }))).toBe(
        'validation_failed'
      );
    });
  });

  describe('a read-only caller', () => {
    it('reads every line', async () => {
      const { lines } = await build();

      expect((await lines.listLines(READ_ONLY)).items).toHaveLength(9);
    });

    it('writes nothing at all', async () => {
      const { lines } = await build();

      expect(await codeOf(lines.addLine(READ_ONLY, 'Mint', 1))).toBe(
        'forbidden'
      );
      expect(await codeOf(lines.setStatus('ln-s-03', 'READY'))).toBe(
        'forbidden'
      );
      expect(await codeOf(lines.deleteLine('ln-s-03'))).toBe('forbidden');
      expect(await codeOf(lines.reorder(READ_ONLY, ['ln-s-03']))).toBe(
        'forbidden'
      );
    });
  });

  describe('a group admin', () => {
    it('adds a line that is already approved, by them', async () => {
      // Rule 1 of backend plan 0037 section 2, and the fix for the approve button that
      // used to flash on the adder's own line.
      const { lines } = await build();

      const line = await lines.addLine(OWNED_LIST, 'Halloumi', 1);

      expect(line.approvalStatus).toBe('APPROVED');
      expect(line.approvedByUserId).not.toBeNull();
    });

    it('edits and deletes an approved line, which MANAGE alone reaches', async () => {
      const { lines } = await build();

      expect(
        (await lines.updateLine('ln-w-01', { content: 'Rye loaf' })).content
      ).toBe('Rye loaf');
      expect(await lines.deleteLine('ln-w-01')).toBe('ln-w-01');
    });
  });

  it('answers not_found for a list the caller cannot see at all', async () => {
    // Before `forbidden`, matching core, so the difference between the two never leaks
    // the existence of a list in a zone the caller is not in.
    const { lines } = await build();

    expect(await codeOf(lines.listLines('list-nowhere'))).toBe('not_found');
  });
});
