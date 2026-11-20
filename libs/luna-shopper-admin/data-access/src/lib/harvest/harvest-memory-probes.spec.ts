import { GatewayError } from '../gateway-error';
import { HarvestMemory } from './harvest-memory';

/**
 * Probes out of memory (admin plan 0069). The start of a run warns from this
 * list, so the red chain has to be reachable with nothing listening.
 */
const MERCADONA = 'sm_mercadona';
const CARREFOUR = 'sm_carrefour';
const DEZA = 'sm_deza';

describe('HarvestMemory, probes', () => {
  it('lists a chain probes newest first, DEZA red on top', async () => {
    const page = await new HarvestMemory().listProbes(DEZA, { limit: 10 });

    expect(page.items.map((probe) => probe.status)).toEqual([
      'UNREACHABLE',
      'PASSED',
    ]);
    expect(page.items[0].error).toContain('home');
    expect(page.nextCursor).toBe(null);
  });

  it('answers a green newest probe for Mercadona', async () => {
    const page = await new HarvestMemory().listProbes(MERCADONA, {});

    expect(page.items[0].status).toBe('PASSED');
  });

  it('answers an empty page for a source with no probe', async () => {
    const page = await new HarvestMemory().listProbes(CARREFOUR, {});

    expect(page.items).toEqual([]);
  });

  it('answers 404 for a chain with no source row', async () => {
    await expect(
      new HarvestMemory().listProbes('no-such-chain', {})
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it('pages by the limit it is given', async () => {
    const page = await new HarvestMemory().listProbes(DEZA, { limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBe(null);
  });
});
