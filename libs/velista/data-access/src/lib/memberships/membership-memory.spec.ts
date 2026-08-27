import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { MyZone } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import { SEED_MEMBERSHIPS, SEED_MY_USERNAME } from '../zones/static-group-data';
import { SEED_USER_ID } from '../zones/static-zone-data';
import { ZoneMemory } from '../zones/zone-memory';
import { MembershipMemory } from './membership-memory';

/**
 * Plan 0010 section 5.4, enforced rather than merely drawn.
 *
 * `memberActionsFor` decides what is **shown**; this is the other half of rule G2, the
 * half that says the server decides what is allowed. A fake that succeeded at
 * everything would leave that half untested until production, and the row that matters
 * most — an admin who may not promote — would be indistinguishable from an owner who
 * may.
 */
async function build(): Promise<{
  members: MembershipMemory;
  zones: ZoneMemory;
}> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideHttpClient(),
      ApiUrl,
      TokenStore,
      ZoneMemory,
      MembershipMemory,
    ],
  }).compileComponents();

  return {
    members: TestBed.inject(MembershipMemory),
    zones: TestBed.inject(ZoneMemory),
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

/** The seeded caller owns `zone-flat`, is an admin of `zone-lab`, a member elsewhere. */
const OWNED = 'zone-flat';
const ADMINED = 'zone-lab';
const MEMBER_OF = 'zone-parents';

describe('MembershipMemory', () => {
  describe('reading the members', () => {
    it('serves the approved ones by default', async () => {
      const { members } = await build();
      const page = await members.listMembers(OWNED);

      expect(page.items.every((row) => row.status === 'APPROVED')).toBe(true);
      expect(page.items).toHaveLength(3);
    });

    it('serves the pending ones to staff', async () => {
      const { members } = await build();
      const page = await members.listMembers(OWNED, {
        statuses: ['APPROVED', 'PENDING'],
      });

      expect(page.items.filter((row) => row.status === 'PENDING')).toHaveLength(
        3
      );
    });

    it('refuses the pending ones to an ordinary member', async () => {
      // A `forbidden`, not an empty page. This is why the screen decides from
      // `myRole` before it asks (rule G2).
      const { members } = await build();

      expect(
        await codeOf(members.listMembers(MEMBER_OF, { statuses: ['PENDING'] }))
      ).toBe('forbidden');
    });
  });

  describe('answering a request', () => {
    it('approves somebody who is waiting', async () => {
      const { members } = await build();
      const updated = await members.approve(OWNED, 'm-flat-ines');

      expect(updated.status).toBe('APPROVED');
    });

    it('answers validation_failed the second time, as a real race would', async () => {
      // The row section 5.6 is written for, reachable here in two calls rather than
      // with two accounts and a stopwatch.
      const { members } = await build();
      await members.approve(OWNED, 'm-flat-ines');

      expect(await codeOf(members.approve(OWNED, 'm-flat-ines'))).toBe(
        'validation_failed'
      );
    });

    it('refuses an ordinary member outright', async () => {
      const { members } = await build();

      expect(await codeOf(members.approve(MEMBER_OF, 'm-parents-rosa'))).toBe(
        'forbidden'
      );
    });
  });

  describe('the three rules that are stricter than they look', () => {
    it('will not let an admin promote anybody', async () => {
      const { members } = await build();

      expect(await codeOf(members.setRole(ADMINED, 'm-lab-pau', 'ADMIN'))).toBe(
        'forbidden'
      );
    });

    it('lets the owner promote and demote', async () => {
      const { members } = await build();

      expect((await members.setRole(OWNED, 'm-flat-marta', 'ADMIN')).role).toBe(
        'ADMIN'
      );
      expect((await members.setRole(OWNED, 'm-flat-toni', 'MEMBER')).role).toBe(
        'MEMBER'
      );
    });

    it('will not remove or ban the owner, for anybody', async () => {
      const { members } = await build();

      expect(await codeOf(members.kick(ADMINED, 'm-lab-sam'))).toBe(
        'forbidden'
      );
      expect(await codeOf(members.ban(ADMINED, 'm-lab-sam'))).toBe('forbidden');
    });

    it('will not let an admin rename the owner', async () => {
      const { members } = await build();

      expect(
        await codeOf(members.setUsername(ADMINED, 'm-lab-sam', 'Samuel'))
      ).toBe('forbidden');
    });
  });

  describe('handing the group over', () => {
    it('promotes the target and demotes the caller in the same call', async () => {
      // A fake that promoted the target and left the caller an owner would let a
      // screen look correct while being wrong about the one thing this is for.
      const { members, zones } = await build();

      await members.transferOwnership(OWNED, 'm-flat-marta');

      const rows = members.members(OWNED);
      expect(rows.find((row) => row.id === 'm-flat-marta')?.role).toBe('OWNER');
      expect(rows.find((row) => row.id === 'm-flat-me')?.role).toBe('ADMIN');
      expect(zoneOf(zones, OWNED)?.myRole).toBe('ADMIN');
    });

    it('refuses an admin', async () => {
      const { members } = await build();

      expect(
        await codeOf(members.transferOwnership(ADMINED, 'm-lab-pau'))
      ).toBe('forbidden');
    });
  });

  describe('renaming', () => {
    it('lets somebody rename themselves whatever their role', async () => {
      const { members } = await build();
      const updated = await members.setUsername(
        MEMBER_OF,
        'm-parents-me',
        'Dani R'
      );

      expect(updated.username).toBe('Dani R');
    });

    it('starts from the seeded name', async () => {
      const { members } = await build();
      const mine = members
        .members(OWNED)
        .find((row) => row.userId === SEED_USER_ID);

      expect(mine?.username).toBe(SEED_MY_USERNAME);
    });

    it('answers rate_limited once the bucket runs out', async () => {
      // Five an hour, mirrored from the gateway's own `usernameChange` bucket, so
      // the refusal a spec drives here is the refusal production produces.
      const { members } = await build();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await members.setUsername(OWNED, 'm-flat-me', `Dani ${attempt}`);
      }

      expect(
        await codeOf(members.setUsername(OWNED, 'm-flat-me', 'Dani again'))
      ).toBe('rate_limited');
    });
  });

  it('seeds every zone the group screens need', async () => {
    // The four zones section 3 needs: one owned, one as an admin, one as a plain
    // member, and one ownerless.
    expect(Object.keys(SEED_MEMBERSHIPS)).toEqual(
      expect.arrayContaining([OWNED, ADMINED, MEMBER_OF, 'zone-rescue'])
    );
  });
});

function zoneOf(zones: ZoneMemory, zoneId: string): MyZone | undefined {
  return zones.zones().find((zone) => zone.id === zoneId);
}
