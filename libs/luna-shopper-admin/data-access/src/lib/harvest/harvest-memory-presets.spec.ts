import { GatewayError } from '../gateway-error';
import { HarvestMemory } from './harvest-memory';
import { MERCADONA_WEEKLY_PRESET } from './harvest-seed';

/**
 * Presets out of memory (admin plan 0030, section 6).
 *
 * The screens draw the duplicate name refusal and the preset a run came from,
 * so both have to be reachable with nothing listening.
 */
const MERCADONA = '11111111-1111-4111-8111-111111111111';
const DEZA = '33333333-3333-4333-8333-333333333333';

describe('HarvestMemory, presets', () => {
  it('lists a chain presets by name, each with its latest run', async () => {
    const memory = new HarvestMemory();
    await memory.createPreset(MERCADONA, 'A first walk', {
      mode: 'CATALOG_DISCOVERY',
    });

    const page = await memory.listPresets(MERCADONA);

    expect(page.items.map((preset) => preset.name)).toEqual([
      'A first walk',
      'Weekly warehouses',
    ]);
    expect(page.items[1].lastRun).toEqual(
      expect.objectContaining({ id: 'run-catalog-completed' })
    );
    expect((await memory.listPresets(DEZA)).items).toEqual([]);
  });

  it('refuses a name the chain already holds, in any case, as the API does', async () => {
    const memory = new HarvestMemory();

    const refusal = await memory
      .createPreset(MERCADONA, '  WEEKLY warehouses ', {
        mode: 'CATALOG_DISCOVERY',
      })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(GatewayError);
    expect(refusal).toMatchObject({ status: 409, code: 'conflict' });
    expect((refusal as GatewayError).detail).toContain(MERCADONA_WEEKLY_PRESET);

    // Another chain may hold the same name.
    await expect(
      memory.createPreset(DEZA, 'Weekly warehouses', {
        mode: 'CATALOG_DISCOVERY',
      })
    ).resolves.toMatchObject({ supermarketId: DEZA });
  });

  it('refuses a rename onto another preset name, and not onto its own', async () => {
    const memory = new HarvestMemory();
    const other = await memory.createPreset(MERCADONA, 'Other', {
      mode: 'CATALOG_DISCOVERY',
    });

    await expect(
      memory.updatePreset(other.id, { name: 'weekly WAREHOUSES' })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      memory.updatePreset(MERCADONA_WEEKLY_PRESET, {
        name: 'Weekly Warehouses',
      })
    ).resolves.toMatchObject({ name: 'Weekly Warehouses' });
  });

  it('records the preset on a run started from it', async () => {
    const memory = new HarvestMemory();
    // The seed holds a running walk, and one harvester runs one thing.
    await memory.abortRun('run-catalog-running');

    const run = await memory.startPreset(MERCADONA_WEEKLY_PRESET);

    expect(run).toMatchObject({
      presetId: MERCADONA_WEEKLY_PRESET,
      supermarketId: MERCADONA,
      mode: 'CATALOG_DISCOVERY',
    });
    const listed = await memory.listRuns({ presetId: MERCADONA_WEEKLY_PRESET });
    expect(listed.items.map((entry) => entry.id)).toContain(run.id);
    expect((await memory.readPreset(MERCADONA_WEEKLY_PRESET)).lastRun?.id).toBe(
      run.id
    );
  });

  it('keeps the runs of a deleted preset', async () => {
    const memory = new HarvestMemory();

    await memory.deletePreset(MERCADONA_WEEKLY_PRESET);

    await expect(
      memory.readPreset(MERCADONA_WEEKLY_PRESET)
    ).rejects.toMatchObject({ status: 404 });
    const runs = await memory.listRuns({ presetId: MERCADONA_WEEKLY_PRESET });
    expect(runs.items).toHaveLength(1);
  });
});
