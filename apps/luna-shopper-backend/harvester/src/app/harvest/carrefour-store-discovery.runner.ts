import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CARREFOUR_FORMATS,
  CARREFOUR_ORIGIN,
  CarrefourClient,
  salePointsByShop,
  type CarrefourDrive,
  type CarrefourFormat,
  type CarrefourStore,
} from '@portfolio/luna-shopper/carrefour';
import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  StoreDiscoveryInput,
  StoreDiscoveryRunner,
} from './store-discovery-runner';

/**
 * `STORE_DISCOVERY` against the `carrefour-web` adapter (plan 0223).
 *
 * **One document names every point of sale.** The public store finder loads
 * `locations.aspx` whole: 1,976 records with coordinates, a postal code, an
 * address, a phone, hours and the format on each. So this case takes no
 * radius and no centre, and a postal code filters what it reports rather than
 * what it fetches.
 *
 * **It reports the formats the source row names** (section 5), hypermarkets
 * and Markets when the row names none. Whether Express shops belong to the
 * Carrefour chain is the owner's question, and this case does not answer it by
 * default.
 *
 * **A sale point is a tag, not a scope** (section 3.3). A hypermarket or Market
 * with an online service names it, and nothing is declared from it, because
 * whether prices differ between sale points is still unmeasured.
 *
 * **It creates nothing** (plan 0103, section 6.4). It reports places for an
 * admin to import, and the trusted import runs only when the row allows it
 * (plan 0107).
 *
 * The browser is given back in a `finally`, as the walk gives back its own.
 */
@Injectable()
export class CarrefourStoreDiscoveryRunner implements StoreDiscoveryRunner {
  private readonly logger = new Logger(CarrefourStoreDiscoveryRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    requireChain(input.supermarketId);
    // Before the browser launches: a refusal here costs no load.
    const formats = readFormats(source?.config ?? {});
    const client = this.createClient(context, source);

    try {
      await context.setStage('STORES', 'Reading every shop the chain names');
      const list = await client.readStoreLocator();

      const allowed = new Set<CarrefourFormat>(formats);
      const ofFormat = list.stores.filter((store) => allowed.has(store.format));
      // The same filter the other chains apply (plan 0107, section 1): after
      // the document is read, on the shop's own postal code, exactly. The
      // document holds every code, so no radius is needed.
      const wanted = normalizeCodes(input.postalCodes);
      const stores =
        wanted.size === 0
          ? ofFormat
          : ofFormat.filter((store) => wanted.has(store.postalCode));
      const unmatched = [...wanted].filter(
        (code) => !ofFormat.some((store) => store.postalCode === code)
      );

      await context.setTotalPlanned(stores.length);
      this.logger.log(
        `Run ${context.runId}: ${stores.length} shop(s) of ` +
          `${list.stores.length} grocery shop(s) named`
      );

      const warnings: string[] = [];
      // The document states no total, so a count far under the measured one
      // is the next best signal that the page changed.
      if (list.stores.length < EXPECTED_AT_LEAST) {
        warnings.push(
          `The store finder named ${list.stores.length} grocery shop(s). It ` +
            `kept 1,586 on 2026-11-06, so a count under ${EXPECTED_AT_LEAST} ` +
            'suggests the document changed.'
        );
      }

      await context.setStage('DRIVES', 'Reading the online sale points');
      const salePoints = await this.readSalePoints(
        context,
        client,
        list.stores,
        warnings
      );
      for (const warning of warnings) {
        this.logger.warn(`Run ${context.runId}: ${warning}`);
      }

      const brandKey = input.chain?.externalBrandKey ?? null;
      const brandName = input.chain?.brandName ?? null;

      await context.setStage('UPSERT', `Recording ${stores.length} place(s)`);
      let withSalePoint = 0;
      for (const store of stores) {
        if (context.signal.aborted) {
          break;
        }
        const drive = salePoints.get(store.externalRef) ?? null;
        if (drive) {
          withSalePoint += 1;
        }
        report.place({
          provider: PROVIDER,
          externalRef: store.externalRef,
          brandKey,
          brandName,
          name: store.name,
          latitude: store.latitude,
          longitude: store.longitude,
          street: store.street,
          city: store.city,
          postalCode: store.postalCode,
          // Stated by the chain on every record kept, so it is a source value
          // in plan 0097's sense. A record with none was dropped and named.
          postalCodeSource: PostalCodeSource.SOURCE,
          country: 'es',
          website: websiteOf(store.web),
          // Three unlabelled lines, kept as tags and never parsed (section
          // 6.2): nothing on the page says which days each one covers.
          openingHours: null,
          tags: tagsOf(store, drive),
          // Deliberately absent: no scope is declared from a sale point until
          // per sale point prices are measured (section 6.2).
          scopeKey: null,
        });
      }

      await context.flush();
      await context.setReport({
        recordsRead: list.recordsRead,
        groceryShops: list.stores.length,
        formats,
        shopsReported: stores.length,
        shopsWithSalePoint: withSalePoint,
        /** Every record the parser left out, with the reason. */
        droppedRecords: list.dropped,
        /** Codes the run was asked for that no shop of these formats sits on. */
        postalCodesWithNoShop: unmatched,
        warnings,
        loads: client.loads,
      });
    } finally {
      // Including when the run failed or aborted, and when it never opened a
      // page (plan 0090, section 11).
      await client.close();
    }
  }

  /**
   * The sale point of each shop, or none when the drive list could not be
   * read. **A failed drive read is not the run's** (section 6.1): the shops
   * are still worth reporting, so it costs a warning and the tags. A refusal
   * that stopped the guard still ends the run, because it means the address
   * is refused and the next load deepens it.
   */
  private async readSalePoints(
    context: RunContext,
    client: CarrefourClient,
    stores: readonly CarrefourStore[],
    warnings: string[]
  ): Promise<Map<string, CarrefourDrive>> {
    try {
      return salePointsByShop(stores, await client.readDrives());
    } catch (error) {
      if (error instanceof SourceBlockedError || context.signal.aborted) {
        throw error;
      }
      warnings.push(
        `The drive list could not be read (${String(error)}), so no shop ` +
          'carries a sale point in this run.'
      );
      return new Map();
    }
  }

  /**
   * The client this run drives.
   *
   * **A seam and not a knob.** Chromium is the one thing about this run a test
   * cannot have, so a test hands back a client built on a fake session.
   * Nothing in the runtime overrides it.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource | null
  ): CarrefourClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    const config = source?.config ?? {};
    return new CarrefourClient({
      baseUrl: readString(config, 'baseUrl'),
      userAgent: settings.userAgent,
      delayMs: readDelay(config),
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
    });
  }
}

/** Who found the place. Not `OSM`, and not the chain's name: the service's. */
const PROVIDER = 'CARREFOUR';

/**
 * The floor for the shops the parser keeps, which is what the warning counts:
 * 1,586 on 2026-11-06. (The 1,597 of 2026-10-22 counted the grocery records
 * before the drops.) Fewer than this is a warning (section 6.4).
 */
const EXPECTED_AT_LEAST = 1400;

/** The formats a row that names none reports (section 5). */
const DEFAULT_FORMATS: readonly CarrefourFormat[] = ['HIPERMERCADO', 'MARKET'];

/**
 * `source.config.storeFormats`, checked. An absent or empty array is the
 * default, and a name that is not a format refuses the run with the valid
 * names, before any load.
 */
function readFormats(config: Record<string, unknown>): CarrefourFormat[] {
  const value = config['storeFormats'];
  if (value === undefined || value === null) {
    return [...DEFAULT_FORMATS];
  }
  if (!Array.isArray(value)) {
    throw new Error(refusal('it is not a list'));
  }
  if (value.length === 0) {
    return [...DEFAULT_FORMATS];
  }
  const known = new Set<string>(CARREFOUR_FORMATS);
  const unknown = value.filter(
    (name) => typeof name !== 'string' || !known.has(name)
  );
  if (unknown.length > 0) {
    throw new Error(
      refusal(`it names ${unknown.map((name) => String(name)).join(', ')}`)
    );
  }
  return [...new Set(value as CarrefourFormat[])];
}

function refusal(why: string): string {
  return (
    `The row's config.storeFormats cannot be read: ${why}. The valid ` +
    `formats are ${CARREFOUR_FORMATS.join(', ')}.`
  );
}

/**
 * The source's own fields, as tags (section 6.3). An absent attribute is no
 * tag.
 */
function tagsOf(
  store: CarrefourStore,
  drive: CarrefourDrive | null
): Record<string, string> {
  const tags: Record<string, string> = {
    'carrefour:format': store.format,
    'carrefour:category': store.category,
  };
  const optional: Array<[string, string | null | undefined]> = [
    ['carrefour:codsa', store.codsa],
    ['carrefour:codat', store.codat],
    ['phone', store.phone],
    ['addr:province', store.province],
    ['carrefour:hours1', store.hours.hours1],
    ['carrefour:hours2', store.hours.hours2],
    ['carrefour:hours3', store.hours.hours3],
    [
      'carrefour:features',
      store.features.length > 0 ? store.features.join(',') : null,
    ],
    ['carrefour:salePoint', drive?.salePointId],
    ['carrefour:driveName', drive?.name || null],
  ];
  for (const [key, value] of optional) {
    if (value) {
      tags[key] = value;
    }
  }
  return tags;
}

/**
 * The shop's page. The document writes a path on the storefront's origin, so
 * it is resolved there, and an absolute address is kept as it is.
 */
function websiteOf(web: string | null): string | null {
  if (!web) {
    return null;
  }
  return web.startsWith('/') ? CARREFOUR_ORIGIN + web : web;
}

/** The codes asked for, trimmed. An empty array is every shop, like an absent one. */
function normalizeCodes(codes: readonly string[] | undefined): Set<string> {
  return new Set(
    (codes ?? []).map((code) => code.trim()).filter((code) => code !== '')
  );
}

function requireChain(supermarketId: string | undefined): string {
  if (!supermarketId) {
    throw new Error(
      'This chain publishes its own shops, so the run has to know which chain ' +
        'it is reading. Start it again naming the supermarket.'
    );
  }
  return supermarketId;
}

/** A setting from the source row rather than the environment (plan 0083). */
function readString(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

/** Never under the client's own floor, which clamps it up. */
function readDelay(config: Record<string, unknown>): number | undefined {
  const delay = Number(config['delayMs']);
  return Number.isFinite(delay) && delay > 0 ? Math.floor(delay) : undefined;
}
