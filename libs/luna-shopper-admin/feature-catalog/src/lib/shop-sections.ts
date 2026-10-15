import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ApiUrl,
  GatewayError,
  notFoundError,
  RESOURCE_GATEWAYS,
  ResourceMemoryGateways,
  toGatewayError,
  type MemoryTables,
} from '@portfolio/luna-shopper-admin/data-access';
import { gatewayErrorKey } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  toLocalizedText,
  type LocalizedText,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom, type Observable } from 'rxjs';
import {
  categorySource,
  itemSource,
  locationItemSectionsPath,
  locationSectionsPath,
  locationSource,
  sectionSource,
} from './catalog-sources';
import {
  sectionsForItem,
  shopSections,
  writeShopOrder,
  type SectionTables,
} from './section-rules';

/** One section of a shop, as the section panel holds it (rule D4). */
export interface ShopSection {
  readonly id: string;
  readonly supermarketLocationId: string;
  readonly slug: string;
  readonly name: LocalizedText;
  readonly position: number;
  readonly categoryIds: readonly string[];
}

/**
 * Which answer the preview gave for a product: a section holds one of its
 * categories, or no section does. A product has no pin since backend plan
 * 0200.
 */
export type SectionRuleStep = 'COVERED' | 'NONE';

/** Where one product is at one shop. */
export interface ItemSectionsAt {
  readonly itemId: string;
  readonly sectionIds: readonly string[];
  readonly step: SectionRuleStep;
}

/** A failure, as the sentence a panel shows. */
export function panelErrorKey(error: unknown): string {
  return error instanceof GatewayError
    ? (gatewayErrorKey(error) ?? 'resource.error.unknown')
    : 'resource.error.unknown';
}

/** Whether a failure is the server refusing with this one code. */
export function isRefusal(error: unknown, code: string): boolean {
  return error instanceof GatewayError && error.code === code;
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

/** A section off the wire. `null` for a record with no id. */
export function toShopSection(value: unknown): ShopSection | null {
  const row = record(value);
  const id = text(row['id']);
  if (id === '') {
    return null;
  }
  const position = row['position'];
  return {
    id,
    supermarketLocationId: text(row['supermarketLocationId']),
    slug: text(row['slug']),
    name: toLocalizedText(row['name']),
    position: typeof position === 'number' ? position : 0,
    categoryIds: ids(row['categoryIds']),
  };
}

/** A shop's sections off the wire, in the order the answer gave them. */
export function toLocationSections(value: unknown): ShopSection[] {
  const body = record(value);
  const sections = Array.isArray(body['sections']) ? body['sections'] : [];
  return sections
    .map(toShopSection)
    .filter((section): section is ShopSection => section !== null);
}

/**
 * The preview's answer off the wire. A step that is not `COVERED` reads as
 * `NONE`, which is the answer that never claims a section: an old answer's
 * `PINNED` among them.
 */
export function toSectionsAtLocation(value: unknown): ItemSectionsAt[] {
  const body = record(value);
  const items = Array.isArray(body['items']) ? body['items'] : [];
  return items
    .map((entry) => {
      const row = record(entry);
      const covered = row['step'] === 'COVERED';
      return {
        itemId: text(row['itemId']),
        sectionIds: covered ? ids(row['sectionIds']) : [],
        step: covered ? ('COVERED' as const) : ('NONE' as const),
      };
    })
    .filter((entry) => entry.itemId !== '');
}

/**
 * The memory tables the rules read. A function rather than a constant,
 * because `catalog-sources` and this file import each other through the rules,
 * and a constant would read the sources before they exist.
 */
function tablesOfSections(): SectionTables {
  return {
    sections: sectionSource,
    categories: categorySource,
    locations: locationSource,
  };
}

/**
 * The section routes of a shop that are not a resource's CRUD (backend plan
 * 0200, section 4): its sections in order, a new order, and where products
 * are at the shop.
 *
 * Over HTTP when the app bound the HTTP gateways, and against the memory
 * tables otherwise, so the panel works with nothing listening.
 *
 * A section is created, changed and deleted through the `sections` resource,
 * either way.
 */
@Injectable({ providedIn: 'root' })
export class ShopSections {
  private readonly _gateways = inject(RESOURCE_GATEWAYS);
  private readonly _http = inject(HttpClient, { optional: true });
  private readonly _urls = inject(ApiUrl, { optional: true });

  /** A shop's sections, in its order. A shop with none answers none. */
  async forLocation(locationId: string): Promise<ShopSection[]> {
    const memory = this._memory();
    if (memory !== null) {
      this._location(memory, locationId);
      return toLocationSections({
        sections: shopSections(locationId, memory, tablesOfSections()),
      });
    }
    return toLocationSections(
      await this._send((http, urls) =>
        http.get<unknown>(urls.gateway(locationSectionsPath(locationId)))
      )
    );
  }

  /**
   * Write the order of a shop's sections, whole. The server keeps a section
   * the list leaves out after the named ones, so the panel always sends all.
   */
  async setOrder(
    locationId: string,
    sectionIds: readonly string[]
  ): Promise<ShopSection[]> {
    const memory = this._memory();
    if (memory !== null) {
      this._location(memory, locationId);
      writeShopOrder(locationId, sectionIds, memory, tablesOfSections());
      return this.forLocation(locationId);
    }
    const body: Wire.SetLocationSectionsDto = { sectionIds: [...sectionIds] };
    return toLocationSections(
      await this._send((http, urls) =>
        http.put<unknown>(urls.gateway(locationSectionsPath(locationId)), body)
      )
    );
  }

  /** Delete one section. Its shop's order closes the gap. */
  remove(sectionId: string): Promise<void> {
    return this._gateways.for(sectionSource()).remove(sectionId);
  }

  /** Where these products are at this shop. */
  async atLocation(
    locationId: string,
    itemIds: readonly string[]
  ): Promise<ItemSectionsAt[]> {
    const memory = this._memory();
    if (memory !== null) {
      this._location(memory, locationId);
      const present = shopSections(locationId, memory, tablesOfSections());
      const items = memory.table(itemSource());
      return toSectionsAtLocation({
        items: [...new Set(itemIds)].map((itemId) => ({
          itemId,
          ...sectionsForItem(
            items.find((item) => item.id === itemId),
            present
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
