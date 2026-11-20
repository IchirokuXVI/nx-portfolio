import { GatewayError } from '../gateway-error';
import { HarvestMemory } from './harvest-memory';
import { MERCADONA_WEEKLY_PRESET } from './harvest-seed';

/**
 * Presets out of memory (admin plan 0030, section 6).
 *
 * The screens draw the duplicate name refusal and the preset a run came from,
 * so both have to be reachable with nothing listening.
 */
const MERCADONA = 'sm_mercadona';
const DEZA = 'sm_deza';
const CARREFOUR = 'sm_carrefour';
const DIA = 'sm_dia';

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
    // DEZA holds the one preset a seeded schedule names (admin plan 0067).
    expect(
      (await memory.listPresets(DEZA)).items.map((preset) => preset.name)
    ).toEqual(['Catalog walk']);
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

  /**
   * One active run per chain, as `uq_harvest_run_active` holds it: the seed's
   * running DEZA walk does not stop a Mercadona start, and the running
   * Mercadona walk does.
   */
  it('refuses a start only while the same chain has a run going', async () => {
    const memory = new HarvestMemory();

    await expect(
      memory.spawnRun({ supermarketId: MERCADONA, mode: 'CATALOG_DISCOVERY' })
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(
      memory.spawnRun({ supermarketId: DEZA, mode: 'CATALOG_DISCOVERY' })
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });

    await memory.abortRun('run-catalog-running');

    await expect(
      memory.spawnRun({ supermarketId: MERCADONA, mode: 'CATALOG_DISCOVERY' })
    ).resolves.toMatchObject({ supermarketId: MERCADONA });
  });

  /**
   * One active store discovery in the whole database, as
   * `uq_harvest_run_active_store_discovery` holds it: a store discovery of
   * another chain is in the way, a catalog run of another chain is not.
   */
  it('refuses a store discovery while a store discovery of another chain is going', async () => {
    const memory = new HarvestMemory();
    await memory.spawnRun({
      supermarketId: CARREFOUR,
      mode: 'STORE_DISCOVERY',
    });

    await expect(
      memory.spawnRun({ supermarketId: DIA, mode: 'STORE_DISCOVERY' })
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(
      memory.spawnRun({ supermarketId: DIA, mode: 'CATALOG_DISCOVERY' })
    ).resolves.toMatchObject({ supermarketId: DIA });
  });

  /** A store discovery with no chain, as the postal code queue starts, also holds the lock. */
  it('refuses a store discovery of a chain while one with no chain is going', async () => {
    const memory = new HarvestMemory();
    await memory.spawnRun({ mode: 'STORE_DISCOVERY' });

    await expect(
      memory.spawnRun({ supermarketId: DIA, mode: 'STORE_DISCOVERY' })
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(
      memory.spawnRun({ mode: 'STORE_DISCOVERY' })
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(
      memory.spawnRun({ supermarketId: CARREFOUR, mode: 'CATALOG_DISCOVERY' })
    ).resolves.toMatchObject({ supermarketId: CARREFOUR });
  });

  /** The seeded DEZA walk counts up on each read, with no total to stop at. */
  it('moves a running walk that does not know its total', async () => {
    const memory = new HarvestMemory();

    const first = await memory.readRun('run-deza-running');
    const second = await memory.readRun('run-deza-running');

    expect(second.processed).toBeGreaterThan(first.processed);
    expect(second).toMatchObject({ status: 'RUNNING', totalPlanned: null });
  });

  it('records the preset on a run started from it', async () => {
    const memory = new HarvestMemory();
    // The seed holds a running Mercadona walk, and a chain runs one run at a
    // time.
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
    // A preset a schedule names cannot be deleted (admin plan 0067), so its
    // two seeded schedules go first.
    for (const schedule of (
      await memory.listSchedules({ presetId: MERCADONA_WEEKLY_PRESET })
    ).items) {
      await memory.deleteSchedule(schedule.id);
    }

    await memory.deletePreset(MERCADONA_WEEKLY_PRESET);

    await expect(
      memory.readPreset(MERCADONA_WEEKLY_PRESET)
    ).rejects.toMatchObject({ status: 404 });
    const runs = await memory.listRuns({ presetId: MERCADONA_WEEKLY_PRESET });
    expect(runs.items).toHaveLength(1);
  });
});
