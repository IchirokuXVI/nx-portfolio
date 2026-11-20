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
/** A chain with no run going in the seed (El Jamón and DIA each have one). */
const CONSUM = 'sm_consum';

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
    // The seed holds the one store discovery a cluster runs at a time.
    await memory.abortRun('run-store-postal-running');
    await memory.spawnRun({
      supermarketId: CARREFOUR,
      mode: 'STORE_DISCOVERY',
    });

    await expect(
      memory.spawnRun({ supermarketId: CONSUM, mode: 'STORE_DISCOVERY' })
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    await expect(
      memory.spawnRun({ supermarketId: CONSUM, mode: 'CATALOG_DISCOVERY' })
    ).resolves.toMatchObject({ supermarketId: CONSUM });
  });

  /** A store discovery with no chain, as the postal code queue starts, also holds the lock. */
  it('refuses a store discovery of a chain while one with no chain is going', async () => {
    const memory = new HarvestMemory();
    await memory.abortRun('run-store-postal-running');
    await memory.spawnRun({ mode: 'STORE_DISCOVERY' });

    await expect(
      memory.spawnRun({ supermarketId: CONSUM, mode: 'STORE_DISCOVERY' })
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

  /**
   * Owner decisions 127b and 130b: a spawn records its chain's source row, its
   * adapter and the fingerprint of its config, the one the seeded runs of the
   * chain walked under. A store discovery of no chain records none of them.
   */
  it('records the source row, adapter and config fingerprint of a spawn', async () => {
    const memory = new HarvestMemory();
    await memory.abortRun('run-catalog-running');
    await memory.abortRun('run-store-postal-running');

    const walk = await memory.spawnRun({
      supermarketId: MERCADONA,
      mode: 'CATALOG_DISCOVERY',
    });
    const seeded = await memory.readRun('run-catalog-completed');
    const anywhere = await memory.spawnRun({ mode: 'STORE_DISCOVERY' });

    expect(walk).toMatchObject({
      sourceId: 'source-mercadona',
      adapterKey: 'mercadona-api',
    });
    expect(walk.configFingerprint).toBeTruthy();
    expect(walk.configFingerprint).toBe(seeded.configFingerprint);
    expect(anywhere).toMatchObject({
      sourceId: null,
      adapterKey: null,
      configFingerprint: null,
    });
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
