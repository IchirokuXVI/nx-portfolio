import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ApiUrl,
  notFoundError,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  toGatewayError,
  type MemoryTables,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  compositeIdOf,
  toLocalizedText,
  type LocalizedText,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom, type Observable } from 'rxjs';
import {
  categorySource,
  chainItemSectionsPath,
  itemSectionPinSource,
  itemSource,
  locationItemSectionsPath,
  locationSectionListSource,
  locationSectionsPath,
  locationSource,
  sectionSource,
} from './catalog-sources';
import {
  chainSections as memoryChainSections,
  ownList,
  presentSections,
  sectionRefusal,
  sectionsForItem,
  shopsOf,
  type SectionTables,
} from './section-rules';
import type { ItemSectionPin, LocationSectionList } from './section-seed';

/** One section of a chain, as the section panels hold it (rule D4). */
export interface ShopSection {
  readonly id: string;
  readonly supermarketId: string;
  readonly slug: string;
  readonly name: LocalizedText;
  readonly position: number;
  readonly categoryIds: readonly string[];
  /** Shops the section is present at. `null` where the read does not say. */
  readonly locationCount: number | null;
}

/** Where a shop's list comes from: its own rows, or its chain's default. */
export type SectionListSource = 'LOCATION' | 'CHAIN';

/** A shop's sections in its order (backend plan 0167, section 4). */
export interface ShopSectionList {
  readonly source: SectionListSource;
  readonly sections: readonly ShopSection[];
}

/** Which step of the rule answered for a product. */
export type SectionRuleStep = 'PINNED' | 'COVERED' | 'NONE';

/** Where one product is at one shop. */
export interface ItemSectionsAt {
  readonly itemId: string;
  readonly sectionIds: readonly string[];
  readonly step: SectionRuleStep;
}

/** The rule of backend plan 0167, section 3, for several products at one shop. */
export interface SectionsAtLocation {
  readonly source: SectionListSource;
  readonly items: readonly ItemSectionsAt[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id !== '')
    : [];
}

function toSource(value: unknown): SectionListSource {
  return value === 'LOCATION' ? 'LOCATION' : 'CHAIN';
}

/** A section off the wire. `null` for a record with no id. */
export function toShopSection(value: unknown): ShopSection | null {
  const row = record(value);
  const id = text(row['id']);
  if (id === '') {
    return null;
  }
  const position = row['position'];
  const count = row['locationCount'];
  return {
    id,
    supermarketId: text(row['supermarketId']),
    slug: text(row['slug']),
    name: toLocalizedText(row['name']),
    position: typeof position === 'number' ? position : 0,
    categoryIds: ids(row['categoryIds']),
    locationCount:
      typeof count === 'number' && Number.isInteger(count) ? count : null,
  };
}

/** A shop's list off the wire. */
export function toLocationSections(value: unknown): ShopSectionList {
  const body = record(value);
  const sections = Array.isArray(body['sections']) ? body['sections'] : [];
  return {
    source: toSource(body['source']),
    sections: sections
      .map(toShopSection)
      .filter((section): section is ShopSection => section !== null),
  };
}

/**
 * The preview's answer off the wire. A step that is not one of the three reads
 * as `NONE`, which is the answer that never claims a section.
 */
export function toSectionsAtLocation(value: unknown): SectionsAtLocation {
  const body = record(value);
  const items = Array.isArray(body['items']) ? body['items'] : [];
  return {
    source: toSource(body['source']),
    items: items
      .map((entry) => {
        const row = record(entry);
        const step = row['step'];
        return {
          itemId: text(row['itemId']),
          sectionIds: ids(row['sectionIds']),
          step:
            step === 'PINNED' || step === 'COVERED'
              ? step
              : ('NONE' as SectionRuleStep),
        };
      })
      .filter((entry) => entry.itemId !== ''),
  };
}

/** The ids one product is pinned to in a chain, off a page of pins. */
export function toPinnedIds(value: unknown, itemId: string): string[] {
  const body = record(value);
  const items = Array.isArray(body['items']) ? body['items'] : [];
  const entry = items.map(record).find((row) => row['itemId'] === itemId);
  return entry === undefined ? [] : ids(entry['sectionIds']);
}

/** How many sections one chain read asks for at a time. */
const SECTION_PAGE_SIZE = 100;

/** The most pages a chain read follows: a chain has tens of aisles, not thousands. */
const SECTION_PAGE_LIMIT = 20;

/**
 * The memory tables the rule reads. A function rather than a constant, because
 * `catalog-sources` and the chain screen import each other through the
 * supermarkets descriptor, and a constant would read the sources before they
 * exist.
 */
function tablesOfSections(): SectionTables {
  return {
    sections: sectionSource,
    categories: categorySource,
    locations: locationSource,
    lists: locationSectionListSource,
    pins: itemSectionPinSource,
  };
}

/**
 * The section routes that are not a resource's CRUD (admin plan 0037; backend
 * plan 0167, section 4): a shop's ordered list, a product's pins in a chain,
 * and where products are at a shop.
 *
 * Shaped like `ProductGroupAssignments`: over HTTP when the app bound the HTTP
 * gateways, and against the memory tables otherwise, so the panels work with
 * nothing listening. The memory half keeps the rule of section 3 itself.
 *
 * A chain's sections themselves are the `sections` resource, and are read
 * through its gateway either way.
 */
@Injectable({ providedIn: 'root' })
export class ShopSections {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _http = inject(HttpClient, { optional: true });
  private readonly _urls = inject(ApiUrl, { optional: true });

  /** Every section of a chain, in the chain's order. */
  async chainSections(supermarketId: string): Promise<ShopSection[]> {
    const gateway = this._gateways.for(sectionSource());
    const read: ShopSection[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < SECTION_PAGE_LIMIT; page += 1) {
      const answer = await gateway.list({
        cursor,
        limit: SECTION_PAGE_SIZE,
        filters: { supermarketId },
      });
      read.push(
        ...answer.items
          .map(toShopSection)
          .filter(
            (section): section is ShopSection =>
              section !== null && section.supermarketId === supermarketId
          )
      );
      if (answer.nextCursor === null) {
        break;
      }
      cursor = answer.nextCursor;
    }
    // The server answers in `position` order. Sorted here as well, stably, so
    // a section created in memory lands where its position says.
    return read
      .map((section, index) => ({ section, index }))
      .sort(
        (a, b) => a.section.position - b.section.position || a.index - b.index
      )
      .map(({ section }) => section);
  }

  /** A shop's sections, in its order, and whether the list is its own. */
  async forLocation(locationId: string): Promise<ShopSectionList> {
    const memory = this._memory();
    if (memory !== null) {
      const location = this._location(memory, locationId);
      const present = presentSections(location, memory, tablesOfSections());
      return toLocationSections({
        source: present.source,
        sections: present.sections,
      });
    }
    return toLocationSections(
      await this._send((http, urls) =>
        http.get<unknown>(urls.gateway(locationSectionsPath(locationId)))
      )
    );
  }

  /**
   * Replace a shop's ordered list, whole. An empty list returns the shop to
   * its chain's default.
   */
  async setForLocation(
    locationId: string,
    sectionIds: readonly string[]
  ): Promise<ShopSectionList> {
    const memory = this._memory();
    if (memory !== null) {
      await this._setListInMemory(memory, locationId, sectionIds);
      return this.forLocation(locationId);
    }
    const body: Wire.SetLocationSectionsDto = { sectionIds: [...sectionIds] };
    return toLocationSections(
      await this._send((http, urls) =>
        http.put<unknown>(urls.gateway(locationSectionsPath(locationId)), body)
      )
    );
  }

  /** The sections one product is pinned to in one chain. Empty means none. */
  async pinsOf(supermarketId: string, itemId: string): Promise<string[]> {
    const memory = this._memory();
    if (memory !== null) {
      const pin = memory
        .table(itemSectionPinSource())
        .find(
          (row) => row.supermarketId === supermarketId && row.itemId === itemId
        );
      return pin === undefined ? [] : [...pin.sectionIds];
    }
    const answer = await this._send((http, urls) =>
      http.get<unknown>(urls.gateway(chainItemSectionsPath(supermarketId)), {
        params: new HttpParams().set('itemId', itemId),
      })
    );
    return toPinnedIds(answer, itemId);
  }

  /** Replace one product's pins in one chain. An empty list removes them. */
  async setPins(
    supermarketId: string,
    itemId: string,
    sectionIds: readonly string[]
  ): Promise<string[]> {
    const memory = this._memory();
    if (memory !== null) {
      return this._setPinsInMemory(memory, supermarketId, itemId, sectionIds);
    }
    const body: Wire.SetItemSectionPinsDto = {
      itemId,
      sectionIds: [...sectionIds],
    };
    const answer = record(
      await this._send((http, urls) =>
        http.put<unknown>(
          urls.gateway(chainItemSectionsPath(supermarketId)),
          body
        )
      )
    );
    return ids(answer['sectionIds']);
  }

  /** Where these products are at this shop, and which step said so. */
  async atLocation(
    locationId: string,
    itemIds: readonly string[]
  ): Promise<SectionsAtLocation> {
    const memory = this._memory();
    if (memory !== null) {
      const location = this._location(memory, locationId);
      const present = presentSections(location, memory, tablesOfSections());
      const items = memory.table(itemSource());
      return toSectionsAtLocation({
        source: present.source,
        items: [...new Set(itemIds)].map((itemId) => ({
          itemId,
          ...sectionsForItem(
            items.find((item) => item.id === itemId),
            location.supermarketId,
            present.sections,
            memory,
            tablesOfSections()
          ),
        })),
      });
    }
    return toSectionsAtLocation(
      await this._send((http, urls) =>
        http.get<unknown>(urls.gateway(locationItemSectionsPath(locationId)), {
          params: new HttpParams().appendAll({ itemIds: [...itemIds] }),
        })
      )
    );
  }

  /** The memory tables, when the app runs with no backend. */
  private _memory(): MemoryTables | null {
    const gateways = this._gateways;
    return gateways instanceof ResourceMemoryGateways
      ? gateways.tables()
      : null;
  }

  private _location(
    memory: MemoryTables,
    locationId: string
  ): Wire.CatalogSupermarketLocationView {
    const location = memory
      .table(locationSource())
      .find((shop) => shop.id === locationId);
    if (location === undefined) {
      throw notFoundError();
    }
    return location;
  }

  private async _setListInMemory(
    memory: MemoryTables,
    locationId: string,
    sectionIds: readonly string[]
  ): Promise<void> {
    const location = this._location(memory, locationId);
    const chain = memoryChainSections(
      location.supermarketId,
      memory,
      tablesOfSections()
    );
    checkSections(sectionIds, chain, memory);

    const lists = this._gateways.for(locationSectionListSource());
    const had = ownList(locationId, memory, tablesOfSections()) !== null;
    if (sectionIds.length === 0) {
      if (had) {
        await lists.remove(locationId);
      }
    } else if (had) {
      await lists.update(locationId, { sectionIds: [...sectionIds] });
    } else {
      const row: LocationSectionList = {
        id: locationId,
        sectionIds: [...sectionIds],
      };
      await lists.create({ ...row });
    }
    await this._recount(memory, location.supermarketId);
  }

  /** Every section's shop count, after a shop's list changed. */
  private async _recount(
    memory: MemoryTables,
    supermarketId: string
  ): Promise<void> {
    const sections = this._gateways.for(sectionSource());
    const shops = shopsOf(supermarketId, memory, tablesOfSections());
    for (const section of memoryChainSections(
      supermarketId,
      memory,
      tablesOfSections()
    )) {
      const count = shops.filter((shop) => {
        const own = ownList(shop.id, memory, tablesOfSections());
        return own === null || own.includes(section.id);
      }).length;
      await sections.update(section.id, { locationCount: count });
    }
  }

  private async _setPinsInMemory(
    memory: MemoryTables,
    supermarketId: string,
    itemId: string,
    sectionIds: readonly string[]
  ): Promise<string[]> {
    const chain = memoryChainSections(
      supermarketId,
      memory,
      tablesOfSections()
    );
    checkSections(sectionIds, chain, memory);

    const pins = this._gateways.for(itemSectionPinSource());
    const key = compositeIdOf({ supermarketId, itemId }, [
      'supermarketId',
      'itemId',
    ]);
    const had = memory
      .table(itemSectionPinSource())
      .some(
        (row) => row.supermarketId === supermarketId && row.itemId === itemId
      );
    // In the chain's order, which is how the server answers.
    const ordered = chain
      .filter((section) => sectionIds.includes(section.id))
      .map((section) => section.id);

    if (ordered.length === 0) {
      if (had) {
        await pins.remove(key);
      }
      return [];
    }
    const row: ItemSectionPin = { supermarketId, itemId, sectionIds: ordered };
    await pins.create({ ...row });
    return ordered;
  }

  private async _send(
    request: (http: HttpClient, urls: ApiUrl) => Observable<unknown>
  ): Promise<unknown> {
    const http = this._http;
    const urls = this._urls;
    if (http === null || urls === null) {
      throw new Error(
        'ShopSections needs HttpClient and ApiUrl when the gateways are not in memory.'
      );
    }
    try {
      return await firstValueFrom(request(http, urls));
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}

/**
 * Each id must name a section, of this chain: an unknown one is
 * `section_not_found`, another chain's is `section_of_another_chain`.
 */
function checkSections(
  sectionIds: readonly string[],
  chain: readonly Wire.CatalogSupermarketSectionView[],
  memory: MemoryTables
): void {
  const all = memory.table(sectionSource());
  for (const id of sectionIds) {
    if (chain.some((section) => section.id === id)) {
      continue;
    }
    throw all.some((section) => section.id === id)
      ? sectionRefusal('section_of_another_chain', 409)
      : sectionRefusal('section_not_found', 404);
  }
}
