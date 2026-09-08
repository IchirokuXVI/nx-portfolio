import type { SupermarketSource } from '../entities';
import type { CarrefourCatalogRunner } from './carrefour-catalog.runner';
import type { CarrefourDetailRunner } from './carrefour-detail.runner';
import { CatalogDiscoveryRunner } from './catalog-discovery.runner';
import type { CatalogDiscoveryInput } from './catalog-runner';
import type { DezaCatalogRunner } from './deza-catalog.runner';
import type { LidlCatalogRunner } from './lidl-catalog.runner';
import type { MercadonaCatalogRunner } from './mercadona-catalog.runner';
import type { RunContext } from './run-context';

/**
 * The dispatch (plan 0085, section 9).
 *
 * One mode, four adapters, and the choice comes from `source.adapterKey`
 * rather than from the mode. The test that matters most here is still the
 * Mercadona one: it takes the Mercadona path whatever is added beside it, which
 * is what says each new adapter broke nothing.
 */
describe('CatalogDiscoveryRunner', () => {
  const context = {} as RunContext;
  const input: CatalogDiscoveryInput = { supermarketId: 'chain-1' };

  function build() {
    const mercadona = { run: jest.fn(async () => undefined) };
    const deza = { run: jest.fn(async () => undefined) };
    const carrefour = { run: jest.fn(async () => undefined) };
    const carrefourDetail = { run: jest.fn(async () => undefined) };
    const lidl = { run: jest.fn(async () => undefined) };
    const runner = new CatalogDiscoveryRunner(
      mercadona as unknown as MercadonaCatalogRunner,
      deza as unknown as DezaCatalogRunner,
      carrefour as unknown as CarrefourCatalogRunner,
      carrefourDetail as unknown as CarrefourDetailRunner,
      lidl as unknown as LidlCatalogRunner
    );
    return { runner, mercadona, deza, lidl };
  }

  const source = (adapterKey: string): SupermarketSource =>
    ({ adapterKey, workers: 1, config: {} }) as SupermarketSource;

  it('sends a mercadona-api source down the Mercadona path', async () => {
    const { runner, mercadona, deza } = build();

    await runner.run(context, input, source('mercadona-api'));

    expect(mercadona.run).toHaveBeenCalledTimes(1);
    expect(deza.run).not.toHaveBeenCalled();
  });

  it('sends a deza-web source down the DEZA path', async () => {
    const { runner, mercadona, deza } = build();

    await runner.run(context, input, source('deza-web'));

    expect(deza.run).toHaveBeenCalledTimes(1);
    expect(mercadona.run).not.toHaveBeenCalled();
  });

  it('sends a lidl-api source down the LIDL path', async () => {
    const { runner, mercadona, lidl } = build();

    await runner.run(context, input, source('lidl-api'));

    expect(lidl.run).toHaveBeenCalledTimes(1);
    expect(mercadona.run).not.toHaveBeenCalled();
  });

  it('refuses an adapter that has no assortment to walk', async () => {
    const { runner } = build();

    // `osm-places` belongs to a store discovery and `manual` means a person
    // types the prices. Reaching here with either is a misconfigured source.
    await expect(runner.run(context, input, source('manual'))).rejects.toThrow(
      /supermarketSource\.upsert/
    );
    await expect(
      runner.run(context, input, source('osm-places'))
    ).rejects.toThrow(/no catalog discovery/);
  });
});
