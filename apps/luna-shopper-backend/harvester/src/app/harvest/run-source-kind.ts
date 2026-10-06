import {
  HarvestRunMode,
  PriceSourceKind,
  type AdapterKey,
} from '@portfolio/luna-shopper/contracts';
import { In, type Repository } from 'typeorm';
import type { HarvestRun, SupermarketSource } from '../entities';

/**
 * What observed a price, per adapter (plan 0103, section 2.3).
 *
 * It is stamped on every row and every price a run writes, and it used to be
 * stated inline by each runner at its own ingest call. The runners write
 * nothing now, so it is stated here, once, and a run of an adapter this map does
 * not know is `OFFICIAL_WEB`: a page a chain publishes is the least specific
 * honest answer, and a file import never reaches here because the operator says
 * what observed it.
 */
const SOURCE_KIND_BY_ADAPTER: Partial<Record<AdapterKey, PriceSourceKind>> = {
  'mercadona-api': PriceSourceKind.OFFICIAL_API,
  'lidl-api': PriceSourceKind.OFFICIAL_API,
  'dia-api': PriceSourceKind.OFFICIAL_API,
  'deza-web': PriceSourceKind.OFFICIAL_WEB,
  'carrefour-web': PriceSourceKind.OFFICIAL_WEB,
  // Named so the lookup of an old price below reads it (plan 0190). A walk
  // of it stamped this before it was named, through the default.
  'eljamon-web': PriceSourceKind.OFFICIAL_WEB,
};

/** The kind a walk of this adapter stamps on what it writes. */
export function sourceKindOf(
  adapterKey: AdapterKey | undefined
): PriceSourceKind {
  return (
    (adapterKey && SOURCE_KIND_BY_ADAPTER[adapterKey]) ??
    PriceSourceKind.OFFICIAL_WEB
  );
}

/** The kinds a run can stamp. A file import names one of them in its input. */
const RUN_KINDS: readonly PriceSourceKind[] = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_LEAFLET,
];

/**
 * The kind each of these runs wrote its prices with (plan 0191).
 *
 * **A fallback since plan 0190.** A price row now says its own kind
 * (`source_entry_prices.sourceKind`), and every run writes it. This is asked
 * only for a price row that has none, which is a row from before that plan
 * whose kind the migration could not read. The migration of plan 0190 read
 * the kind the same way, in SQL.
 *
 * The kind of a source row never was the answer: before plan 0190 every full
 * observation rewrote it, and since then it says who owns the text of the
 * row. A price row keeps the run that observed it, and a run has one kind for
 * its whole life. So the kind of such a price is asked of its run:
 *
 * - **A file import** was stamped by the operator, and the stamp is in the
 *   run's input.
 * - **Any other run** wrote with the kind of its chain's adapter, which is
 *   what `RunExecutor` hands the sink. Only an adapter the map above names
 *   answers: `osm-places` and `manual` walk no storefront, and the default
 *   of {@link sourceKindOf} is for a run that is starting, not for a price
 *   whose kind is in doubt. The migration of plan 0190 draws the same line.
 *
 * **A run that cannot be read answers nothing**, and the caller treats that
 * as "unknown" and not as a guess: the run is gone, its input names no kind,
 * or its chain has no source row any more. An unknown kind is the case in
 * which nothing is removed.
 */
export async function sourceKindsOfRuns(
  runs: Repository<HarvestRun>,
  sources: Repository<SupermarketSource>,
  runIds: readonly string[]
): Promise<Map<string, PriceSourceKind>> {
  const kinds = new Map<string, PriceSourceKind>();
  const ids = [...new Set(runIds)];
  if (ids.length === 0) {
    return kinds;
  }
  const found = await runs.find({ where: { id: In(ids) } });
  const chains = [
    ...new Set(
      found
        .filter((run) => run.mode !== HarvestRunMode.FILE_IMPORT)
        .map((run) => run.supermarketId)
        .filter((id): id is string => !!id)
    ),
  ];
  const adapterOf = new Map(
    chains.length === 0
      ? []
      : (await sources.find({ where: { supermarketId: In(chains) } })).map(
          (source): [string, AdapterKey] => [
            source.supermarketId,
            source.adapterKey,
          ]
        )
  );
  for (const run of found) {
    if (run.mode === HarvestRunMode.FILE_IMPORT) {
      const stamped = run.input?.['sourceKind'] as PriceSourceKind | undefined;
      if (stamped && RUN_KINDS.includes(stamped)) {
        kinds.set(run.id, stamped);
      }
      continue;
    }
    const adapterKey = run.supermarketId
      ? adapterOf.get(run.supermarketId)
      : undefined;
    const named = adapterKey ? SOURCE_KIND_BY_ADAPTER[adapterKey] : undefined;
    if (named) {
      kinds.set(run.id, named);
    }
  }
  return kinds;
}
