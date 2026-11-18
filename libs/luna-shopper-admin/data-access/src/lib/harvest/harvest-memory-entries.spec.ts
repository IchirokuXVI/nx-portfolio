import { HarvestMemory } from './harvest-memory';
import { CARREFOUR_ACEITE_ENTRY, CARREFOUR_YOGUR_ENTRY } from './harvest-seed';

/**
 * One source entry out of memory, addressed by its id (admin plan 0073).
 *
 * The rule is the route's: an id answers that one row whatever its status,
 * every other filter still applies, and with no status the default of the two
 * waiting statuses is not added.
 */
const CARREFOUR = '22222222-2222-4222-8222-222222222222';
const MERCADONA = '11111111-1111-4111-8111-111111111111';

describe('HarvestMemory, one entry by its id', () => {
  it('answers the row with no status given, an ACTIVE row included', async () => {
    const memory = new HarvestMemory();

    const page = await memory.listEntries({
      entryId: CARREFOUR_ACEITE_ENTRY,
      supermarketId: CARREFOUR,
    });

    expect(page.items.map((entry) => [entry.id, entry.status])).toEqual([
      [CARREFOUR_ACEITE_ENTRY, 'ACTIVE'],
    ]);
  });

  it('answers a waiting row by its id as well', async () => {
    const memory = new HarvestMemory();

    const page = await memory.listEntries({ entryId: CARREFOUR_YOGUR_ENTRY });

    expect(page.items.map((entry) => entry.id)).toEqual([
      CARREFOUR_YOGUR_ENTRY,
    ]);
  });

  it('answers nothing when a status is given that the row does not have', async () => {
    const memory = new HarvestMemory();

    const page = await memory.listEntries({
      entryId: CARREFOUR_ACEITE_ENTRY,
      status: 'CANDIDATE',
    });

    expect(page.items).toEqual([]);
  });

  it('answers nothing when the chain given is not the row chain', async () => {
    const memory = new HarvestMemory();

    const page = await memory.listEntries({
      entryId: CARREFOUR_ACEITE_ENTRY,
      supermarketId: MERCADONA,
    });

    expect(page.items).toEqual([]);
  });

  it('keeps the waiting statuses when no id is asked for', async () => {
    const memory = new HarvestMemory();

    const page = await memory.listEntries({ supermarketId: CARREFOUR });

    expect(page.items.map((entry) => entry.id)).toEqual([
      CARREFOUR_YOGUR_ENTRY,
    ]);
  });
});
