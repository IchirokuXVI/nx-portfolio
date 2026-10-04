import { compositeId } from '@portfolio/luna-shopper-admin/models';
import { BASKET_SEED, LIST_SEED, USER_SEED, ZONE_SEED } from './people-seed';
import { bootShoppers, currentUrl } from './shoppers.testing';

/**
 * The addresses the six flat screens had (admin plan 0045, target 8).
 *
 * One spec for each redirect, through the real route table: a redirect is a
 * claim about where an address lands, and only the router can say where that
 * is. The rows are the in-memory ones, so the three redirects that read a row
 * to find its parent read a real one.
 */

const [ROSA] = USER_SEED;
const [KITCHEN] = ZONE_SEED;
const [WEEKLY] = LIST_SEED;
const [SATURDAY] = BASKET_SEED;

const PEOPLE = '/shoppers/people';
const ZONES = '/shoppers/zones';

async function landing(url: string): Promise<string> {
  await bootShoppers(url);
  return currentUrl();
}

describe('the old addresses of the shoppers screens', () => {
  describe('users', () => {
    it('sends the list to People', async () => {
      expect(await landing('/shoppers/users')).toBe(PEOPLE);
    });

    it('sends one user to that person', async () => {
      expect(await landing(`/shoppers/users/${ROSA.userId}`)).toBe(
        `${PEOPLE}/${ROSA.userId}/details`
      );
    });

    it('sends the form of one user to that person', async () => {
      expect(await landing(`/shoppers/users/${ROSA.userId}/edit`)).toBe(
        `${PEOPLE}/${ROSA.userId}/details`
      );
    });
  });

  describe('memberships', () => {
    it('sends the list to Zones', async () => {
      expect(await landing('/shoppers/memberships')).toBe(ZONES);
    });

    it('sends the list of one zone to the Members tab of that zone', async () => {
      expect(await landing(`/shoppers/memberships?zoneId=${KITCHEN.id}`)).toBe(
        `${ZONES}/${KITCHEN.id}/members`
      );
    });

    it('sends one membership to its form under its zone', async () => {
      const id = compositeId([KITCHEN.id, KITCHEN.members[1].membershipId]);

      expect(await landing(`/shoppers/memberships/${id}`)).toBe(
        `${ZONES}/${KITCHEN.id}/members/${id}`
      );
    });
  });

  describe('lists', () => {
    it('sends the list to Zones', async () => {
      expect(await landing('/shoppers/lists')).toBe(ZONES);
    });

    it('sends the list of one zone to the Lists tab of that zone', async () => {
      expect(await landing(`/shoppers/lists?zoneId=${KITCHEN.id}`)).toBe(
        `${ZONES}/${KITCHEN.id}/lists`
      );
    });

    it('reads one list and goes to it under its zone', async () => {
      expect(await landing(`/shoppers/lists/${WEEKLY.id}`)).toBe(
        `${ZONES}/${WEEKLY.zoneId}/lists/${WEEKLY.id}`
      );
    });

    it('lands on Zones for a list that cannot be read', async () => {
      expect(await landing('/shoppers/lists/no-such-list')).toBe(ZONES);
    });
  });

  describe('list lines', () => {
    it('sends the list to Zones', async () => {
      expect(await landing('/shoppers/list-lines')).toBe(ZONES);
    });

    it('reads the list of one line and goes to that list under its zone', async () => {
      const id = compositeId([WEEKLY.id, WEEKLY.lines[0].id]);

      expect(await landing(`/shoppers/list-lines/${id}`)).toBe(
        `${ZONES}/${WEEKLY.zoneId}/lists/${WEEKLY.id}`
      );
    });

    it('lands on Zones for a line whose list cannot be read', async () => {
      expect(await landing('/shoppers/list-lines/nowhere~nothing')).toBe(ZONES);
    });
  });

  describe('shopping lists', () => {
    it('sends the list to People', async () => {
      expect(await landing('/shoppers/shopping-lists')).toBe(PEOPLE);
    });

    it('sends the list of one owner to the tab of that person', async () => {
      expect(
        await landing(`/shoppers/shopping-lists?ownerUserId=${ROSA.userId}`)
      ).toBe(`${PEOPLE}/${ROSA.userId}/shopping-lists`);
    });

    it('sends the list of one zone to the tab of that zone', async () => {
      expect(
        await landing(`/shoppers/shopping-lists?zoneId=${KITCHEN.id}`)
      ).toBe(`${ZONES}/${KITCHEN.id}/shopping-lists`);
    });

    it('reads one shopping list and goes to it under its owner', async () => {
      expect(await landing(`/shoppers/shopping-lists/${SATURDAY.id}`)).toBe(
        `${PEOPLE}/${SATURDAY.ownerUserId}/shopping-lists/${SATURDAY.id}`
      );
    });

    it('lands on People for a shopping list that cannot be read', async () => {
      expect(await landing('/shoppers/shopping-lists/no-such-basket')).toBe(
        PEOPLE
      );
    });
  });

  /** Zones kept their address, so a bookmark of one still opens it. */
  it('leaves the address of a zone as it was', async () => {
    expect(await landing(`${ZONES}/${KITCHEN.id}`)).toBe(
      `${ZONES}/${KITCHEN.id}/members`
    );
  });
});
