import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostalCodeSource } from '@portfolio/luna-shopper/contracts';
import {
  DEZA_SHOP_LINK_TEXT,
  DezaClient,
  DezaShopPageRefusedError,
  readShopCode,
  type DezaDirectoryEntry,
  type DezaShopPage,
} from '@portfolio/luna-shopper/deza';
import { distanceMetres } from '@portfolio/luna-shopper/osm-places';
import { SPAIN_POSTAL_CODE_CENTROIDS } from '@portfolio/luna-shopper/postal-codes/dataset';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';
import type { HarvesterConfig } from '../config/app-config';
import type { SupermarketSource } from '../entities';
import { normalizeName } from './matching';
import type { RunContext } from './run-context';
import type { RunReport } from './run-report';
import type {
  StoreDiscoveryInput,
  StoreDiscoveryRunner,
} from './store-discovery-runner';

/**
 * `STORE_DISCOVERY` against the `deza-web` adapter (plan 0222).
 *
 * **The chain publishes its own shops**, on `/centros/`: a map of pins with
 * coordinates and no postal code, and one page per shop that states the
 * postal code and the phone. The code of a shop (`T1`, `C2`, `Z1`), which
 * every product popup uses, is read from two signals, and a shop with no code
 * or with two codes that disagree is named in the report and not reported.
 *
 * **A postal code narrows before it filters** (section 5), as the DIA runner
 * does: the pins have no postal code, so a run for a code reads only the
 * pages within a radius of its centroid, then keeps the exact matches. Away
 * from Córdoba that is one request.
 *
 * **It creates nothing** (plan 0103, section 6.4; plan 0038, section 6.1). It
 * reports places for an admin to import, writes no `source_locations` row and
 * maps none.
 */
@Injectable()
export class DezaStoreDiscoveryRunner implements StoreDiscoveryRunner {
  private readonly logger = new Logger(DezaStoreDiscoveryRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(
    context: RunContext,
    report: RunReport,
    input: StoreDiscoveryInput,
    source: SupermarketSource | null
  ): Promise<void> {
    requireChain(input.supermarketId);
    // The plan is the shop pages to read, so a page is the unit of
    // `processed` and the sink adds no places to it (plan 0217).
    context.countProgressItself();
    const client = this.createClient(context, source);
    const outcome = new ShopRun();

    await context.setStage('STORES', 'Reading the shop list of the chain');
    const directory = await client.fetchShopDirectory();
    outcome.entriesRead =
      directory.entries.length + directory.withoutCoordinates.length;
    for (const title of directory.withoutCoordinates) {
      outcome.droppedEntries.push({ title, reason: 'NO_COORDINATES' });
    }

    const shops: DezaDirectoryEntry[] = [];
    for (const entry of directory.entries) {
      if (
        entry.shopPageUrl !== null &&
        entry.linkText?.startsWith(DEZA_SHOP_LINK_TEXT)
      ) {
        shops.push(entry);
      } else {
        outcome.droppedEntries.push({
          title: entry.title,
          reason: 'NOT_A_SHOP',
        });
      }
    }
    outcome.shopEntries = shops.length;
    if (shops.length < EXPECTED_AT_LEAST) {
      const warning =
        `The shop list named ${shops.length} shop(s). It named 10 on ` +
        `2026-10-22, so a count under ${EXPECTED_AT_LEAST} suggests the page ` +
        'changed.';
      outcome.warnings.push(warning);
      this.logger.warn(`Run ${context.runId}: ${warning}`);
    }

    const wanted = normalizeCodes(input.postalCodes);
    const candidates =
      wanted.size === 0
        ? shops
        : this.near(
            shops,
            wanted,
            readPositive(source?.config ?? {}, 'postalCodeRadiusMetres') ??
              DEFAULT_POSTAL_CODE_RADIUS_METRES,
            outcome
          );
    await context.setTotalPlanned(candidates.length);
    await context.setStage(
      'STORES',
      `Reading ${candidates.length} shop page(s)`
    );

    const kept: Array<{
      entry: DezaDirectoryEntry;
      page: DezaShopPage;
      code: string;
      basis: string;
    }> = [];
    for (const entry of candidates) {
      if (context.signal.aborted) {
        break;
      }
      const url = entry.shopPageUrl as string;
      let page: DezaShopPage;
      try {
        page = await client.fetchShopPage(url);
      } catch (error) {
        if (error instanceof DezaShopPageRefusedError) {
          // Named by third party markup and never fetched (section 3).
          outcome.droppedEntries.push({
            title: entry.title,
            reason: 'OFF_SITE',
          });
          continue;
        }
        if (error instanceof SourceBlockedError || context.signal.aborted) {
          throw error;
        }
        outcome.failedShops.push({ title: entry.title, error: String(error) });
        await context.report({ failed: 1 });
        continue;
      }
      outcome.pagesRead += 1;
      await context.report({ processed: 1 });

      const code = readShopCode(entry, page);
      if (code.code === null) {
        // A place keyed on anything but the code would become a second place
        // on the day the code appears (section 6.2).
        outcome.shopsWithoutCode.push({
          title: entry.title,
          reason: code.reason,
        });
        continue;
      }
      if (wanted.size > 0 && !wanted.has(page.postalCode ?? '')) {
        // Near a wanted code and in another one: a shop nobody asked for.
        continue;
      }
      kept.push({ entry, page, code: code.code, basis: code.basis });
    }
    for (const code of wanted) {
      if (!kept.some(({ page }) => page.postalCode === code)) {
        outcome.postalCodesWithNoShop.push(code);
      }
    }

    const brandKey = input.chain?.externalBrandKey ?? null;
    const brandName = input.chain?.brandName ?? null;
    await context.setStage('UPSERT', `Recording ${kept.length} place(s)`);
    for (const { entry, page, code, basis } of kept) {
      if (context.signal.aborted) {
        break;
      }
      if (
        entry.mapAddress &&
        page.street &&
        addressesDisagree(entry.mapAddress, page.street)
      ) {
        outcome.addressDisagreements.push({
          code,
          mapAddress: entry.mapAddress,
          pageStreet: page.street,
        });
      }
      const url = entry.shopPageUrl as string;
      report.place({
        provider: PROVIDER,
        // The chain's own key in every popup, and what the shop queue joins
        // on (section 6.2).
        externalRef: code,
        brandKey,
        brandName,
        // The menu names the street, as the popup does. The pin says
        // `Tienda 1`, which names nothing a shopper knows.
        name: directory.menuTitles.get(url) || page.title || entry.title,
        latitude: entry.latitude,
        longitude: entry.longitude,
        street: page.street,
        city: page.city,
        postalCode: page.postalCode,
        postalCodeSource: page.postalCode ? PostalCodeSource.SOURCE : null,
        country: 'es',
        website: url,
        // The calendar page fills the hours from a script (section 8).
        openingHours: null,
        tags: tagsOf(entry, page, code, basis),
        // DEZA states no price, so it names no group of shops (plan 0085).
        scopeKey: null,
      });
      outcome.shopsReported += 1;
    }

    await context.flush();
    await context.setReport({
      ...outcome.toReport(),
      requests: client.requests,
    });
    this.logger.log(
      `Run ${context.runId}: ${outcome.shopsReported} shop(s) of ` +
        `${outcome.shopEntries} named, ${client.requests} request(s)`
    );
  }

  /**
   * The shop entries within `radiusMetres` of the centroid of a wanted code,
   * in directory order. A code with no centroid has nothing to be near, so it
   * makes the run read every entry: a missed shop is worse than ten requests.
   */
  private near(
    shops: readonly DezaDirectoryEntry[],
    wanted: ReadonlySet<string>,
    radiusMetres: number,
    outcome: ShopRun
  ): DezaDirectoryEntry[] {
    const centroids = centroidsOf(wanted);
    const missing = [...wanted].filter((code) => !centroids.has(code));
    if (missing.length > 0) {
      outcome.warnings.push(
        `No centroid is known for ${missing.join(', ')}, so every shop page ` +
          'was read.'
      );
      return [...shops];
    }
    return shops.filter((shop) =>
      [...centroids.values()].some(
        (centroid) =>
          distanceMetres(
            { lat: shop.latitude, lon: shop.longitude },
            { lat: centroid.latitude, lon: centroid.longitude }
          ) <= radiusMetres
      )
    );
  }

  /**
   * The client this run drives. **A seam and not a knob**: a test hands back a
   * client built on a fake fetch, and nothing in the runtime overrides it.
   * One client serves the whole run, because the shop pages need no session.
   */
  protected createClient(
    context: RunContext,
    source: SupermarketSource | null
  ): DezaClient {
    const settings = this.config.getOrThrow<HarvesterConfig>('harvester');
    return new DezaClient({
      userAgent: settings.userAgent,
      baseUrl: readString(source?.config ?? {}, 'baseUrl'),
      acquire: context.acquire,
      guard: context.guard,
      signal: context.signal,
    });
  }
}

/** Who found the place. Not `OSM`, and not the chain's name: the service's. */
const PROVIDER = 'DEZA';

/** 10 shops on 2026-10-22. Fewer than this is a warning (section 6.4). */
const EXPECTED_AT_LEAST = 8;

/** How far a shop may sit from a wanted code's centroid and be read (section 5). */
const DEFAULT_POSTAL_CODE_RADIUS_METRES = 5_000;

/** What one store discovery accumulates, and the report it writes (section 6.4). */
class ShopRun {
  entriesRead = 0;
  shopEntries = 0;
  pagesRead = 0;
  shopsReported = 0;
  readonly droppedEntries: Array<{
    title: string;
    reason: 'NOT_A_SHOP' | 'OFF_SITE' | 'NO_COORDINATES';
  }> = [];
  readonly shopsWithoutCode: Array<{
    title: string;
    reason: 'NO_CODE' | 'CODES_DISAGREE';
  }> = [];
  readonly addressDisagreements: Array<{
    code: string;
    mapAddress: string;
    pageStreet: string;
  }> = [];
  readonly failedShops: Array<{ title: string; error: string }> = [];
  readonly postalCodesWithNoShop: string[] = [];
  readonly warnings: string[] = [];

  toReport(): Record<string, unknown> {
    return {
      entriesRead: this.entriesRead,
      shopEntries: this.shopEntries,
      pagesRead: this.pagesRead,
      shopsReported: this.shopsReported,
      droppedEntries: this.droppedEntries,
      shopsWithoutCode: this.shopsWithoutCode,
      addressDisagreements: this.addressDisagreements,
      failedShops: this.failedShops,
      postalCodesWithNoShop: this.postalCodesWithNoShop,
      warnings: this.warnings,
    };
  }
}

/**
 * Whether the pin and the page name two streets. Equal after
 * {@link normalizeName} agrees. Otherwise the house number decides alone, so
 * `Avenida de Jesús Rescatado, 15` and `Avda. Jesús Rescatado, 15` agree and
 * `48` against `21` does not.
 */
export function addressesDisagree(
  mapAddress: string,
  pageStreet: string
): boolean {
  const map = normalizeName(mapAddress);
  const page = normalizeName(pageStreet);
  if (map === page) {
    return false;
  }
  return houseNumberOf(map) !== houseNumberOf(page);
}

function houseNumberOf(normalized: string): string | null {
  return /\b(\d+)\b/.exec(normalized)?.[1] ?? null;
}

/** What the source said about the shop, as strings, kept whole. */
function tagsOf(
  entry: DezaDirectoryEntry,
  page: DezaShopPage,
  code: string,
  basis: string
): Record<string, string> {
  const tags: Record<string, string> = {
    'deza:code': code,
    'deza:codeBasis': basis,
    'deza:postId': entry.postId,
    'deza:mapTitle': entry.title,
  };
  if (entry.mapAddress) {
    tags['deza:mapAddress'] = entry.mapAddress;
  }
  const phone = page.phone ?? entry.phone;
  if (phone) {
    tags['phone'] = phone;
  }
  return tags;
}

/** The centroid of each requested code that the dataset holds. */
function centroidsOf(
  codes: ReadonlySet<string>
): Map<string, { latitude: number; longitude: number }> {
  const found = new Map<string, { latitude: number; longitude: number }>();
  for (const centroid of SPAIN_POSTAL_CODE_CENTROIDS) {
    if (codes.has(centroid.postalCode)) {
      found.set(centroid.postalCode, centroid);
    }
  }
  return found;
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

function readPositive(
  config: Record<string, unknown>,
  key: string
): number | undefined {
  const value = Number(config[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
