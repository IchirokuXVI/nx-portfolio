import { GatewayError } from '../gateway-error';
import { HarvestMemory } from './harvest-memory';

/**
 * Probes out of memory (admin plan 0069). The start of a run warns from this
 * list, so the red chain has to be reachable with nothing listening.
 */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const CARREFOUR = '22222222-2222-4222-8222-222222222222';
const DEZA = '33333333-3333-4333-8333-333333333333';

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
