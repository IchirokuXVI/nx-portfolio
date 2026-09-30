import { computed, inject, Injectable, signal } from '@angular/core';
import { shopperView } from '@portfolio/luna-shopper/shop-map/model';
import {
  BASKET_ROW_STATES,
  shopMapLinesOf,
  type BasketRowState,
  type ShopMap,
  type ShopMapLine,
  type ShopMapRead,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { BASKET_SERVICE, type BasketServiceI } from '../baskets/basket-service';
import { BASKET_VIEW_LIFETIME_MS } from '../baskets/basket-view-memory';
import { isRecord, mapArray, numOr, str } from '../mapping/primitives';
import { toShopMapRead } from '../mapping/shop-map-mappers';
import { SHOP_MAP_SERVICE, type ShopMapServiceI } from './shop-map-service';

/** Where the map page stands: reading, a map, no map for this shop, or no answer. */
export type ShopMapStatus = 'idle' | 'loading' | 'map' | 'none' | 'failed';

/**
 * Which basket the map counts from: a basket id, `live` for the basket that is
 * always there, or null for a map opened from the shop page with no basket.
 */
export type ShopMapBasketRef = string | null;

/** The record this store keeps on the device (velista `0121`, target 6). */
interface ShopMapRecord {
  readonly version: 1;
  readonly locationId: string;
  /** ISO instant after which the record is ignored. */
  readonly until: string;
  /** The map in the wire's shape, read back through the wire's mapper. */
  readonly body: unknown;
  readonly basket: ShopMapBasketRef;
  readonly lines: readonly ShopMapLine[] | null;
}

/**
 * The map of the shop somebody opened, and the basket lines it counts (velista
 * `0121`, targets 3, 4 and 6).
 *
 * ## One shop at a time
 *
 * The map page opens one, and the section sheet over it reads the same one: the
 * sheet is a child route, so this lives above both, in the app layer. Opening
 * another shop replaces it.
 *
 * ## The lines come from the basket that opened the map
 *
 * The map page is its own route and not a child of the basket, so it cannot reach
 * the basket's route scoped stores. It reads the basket once, at this shop, and
 * keeps the lines a badge needs. So the counts are the basket's as it stood when
 * the map opened, and reopening the map reads them again.
 *
 * ## It opens with no signal
 *
 * Every map read that answers is kept on the device with the lines it was opened
 * with, for as long as the basket keeps its shop choice (two hours, velista
 * `0102`). A read that does not answer falls back to that record when it is for
 * the same shop and has not expired. Only a map somebody opened is kept: nothing
 * reads a map ahead of time.
 *
 * Written by hand, with no `@angular/core/rxjs-interop`.
 */
// Provided by the app layer, never root: rule D5.
@Injectable()
export class ShopMapStore {
  private readonly _service = inject<ShopMapServiceI>(SHOP_MAP_SERVICE);
  private readonly _baskets = inject<BasketServiceI>(BASKET_SERVICE);
  private readonly _browser = inject(BrowserFacade);

  private readonly _locationId = signal<string | null>(null);
  private readonly _basket = signal<ShopMapBasketRef>(null);
  private readonly _read = signal<ShopMapRead | null>(null);
  private readonly _lines = signal<readonly ShopMapLine[] | null>(null);
  private readonly _fromDevice = signal(false);

  /** The read that is current, so an answer for a shop left behind is dropped. */
  private _seq = 0;

  /** The shop whose map is open, or null. */
  readonly locationId = this._locationId.asReadonly();

  /** Which basket the counts come from, or null for none. */
  readonly basket = this._basket.asReadonly();

  readonly status = computed<ShopMapStatus>(() => {
    if (this._locationId() === null) {
      return 'idle';
    }
    return this._read()?.kind ?? 'loading';
  });

  /** The map, once one has been read. */
  readonly map = computed<ShopMap | null>(() => {
    const read = this._read();
    return read?.kind === 'map' ? read.map : null;
  });

  /**
   * The basket's lines at this shop, or null when the map was opened with no
   * basket or the basket could not be read at this shop: then "My list" is
   * absent and no section carries a badge.
   */
  readonly lines = this._lines.asReadonly();

  /** Whether what is drawn came from the device because the network did not answer. */
  readonly fromDevice = this._fromDevice.asReadonly();

  /**
   * Open a shop's map, counting from a basket or from none.
   *
   * Opening the map that is already open with the same basket reads again, so
   * counts settled on the basket since are drawn.
   */
  async open(locationId: string, basket: ShopMapBasketRef): Promise<void> {
    const seq = (this._seq += 1);
    const same = this._locationId() === locationId && this._basket() === basket;
    this._locationId.set(locationId);
    this._basket.set(basket);
    if (!same) {
      this._read.set(null);
      this._lines.set(null);
      this._fromDevice.set(false);
    }

    const [read, lines] = await Promise.all([
      this._readMap(locationId),
      basket === null
        ? Promise.resolve<readonly ShopMapLine[] | null>(null)
        : this._readLines(basket, locationId),
    ]);
    if (seq !== this._seq) {
      return;
    }

    if (read.kind === 'failed') {
      const kept = this._recall(locationId, basket);
      if (kept !== null) {
        this._read.set(kept.read);
        this._lines.set(lines ?? kept.lines);
        this._fromDevice.set(true);
        return;
      }
      if (this._read()?.kind === 'map') {
        // A map is already drawn, from an earlier read: keep it rather than
        // swapping a working map for an error.
        this._lines.set(lines ?? this._lines());
        return;
      }
    }

    this._read.set(read);
    this._lines.set(lines);
    this._fromDevice.set(false);
    if (read.kind === 'map') {
      this._remember(locationId, basket, read.map, lines);
    }
  }

  /** Read the open shop's map again, which is what the page's retry does. */
  async retry(): Promise<void> {
    const locationId = this._locationId();
    if (locationId !== null) {
      await this.open(locationId, this._basket());
    }
  }

  private async _readMap(locationId: string): Promise<ShopMapRead> {
    try {
      return await this._service.map(locationId);
    } catch {
      return { kind: 'failed' };
    }
  }

  private async _readLines(
    basket: string,
    locationId: string
  ): Promise<readonly ShopMapLine[] | null> {
    try {
      const read =
        basket === 'live'
          ? await this._baskets.getLiveBasket(locationId)
          : await this._baskets.getBasket(basket, locationId);
      return shopMapLinesOf(read);
    } catch {
      return null;
    }
  }

  private _remember(
    locationId: string,
    basket: ShopMapBasketRef,
    map: ShopMap,
    lines: readonly ShopMapLine[] | null
  ): void {
    const kept = BASKET_VIEW_LIFETIME_MS.location;
    const lifetime = typeof kept === 'number' ? kept : 0;
    const record: ShopMapRecord = {
      version: 1,
      locationId,
      until: new Date(Date.now() + lifetime).toISOString(),
      body: {
        map: {
          walkId: map.walkId,
          savedAt: map.savedAt?.toISOString() ?? null,
          view: shopperView(map.document),
          sections: map.sections,
        },
      },
      basket,
      lines,
    };
    try {
      this._browser.writeStorage(StorageKeys.shopMap, JSON.stringify(record));
    } catch {
      // A full or refused storage costs the offline copy and nothing else.
    }
  }

  /** The kept map for this shop, read back under rule D4, or null. */
  private _recall(
    locationId: string,
    basket: ShopMapBasketRef
  ): {
    readonly read: ShopMapRead;
    readonly lines: readonly ShopMapLine[] | null;
  } | null {
    let raw: unknown;
    try {
      raw = JSON.parse(this._browser.readStorage(StorageKeys.shopMap) ?? '');
    } catch {
      return null;
    }
    if (!isRecord(raw) || raw['version'] !== 1) {
      return null;
    }
    const until = Date.parse(str(raw['until']) ?? '');
    if (
      raw['locationId'] !== locationId ||
      !Number.isFinite(until) ||
      until <= Date.now()
    ) {
      return null;
    }
    const read = toShopMapRead(raw['body']);
    if (read.kind !== 'map') {
      return null;
    }
    const lines =
      basket !== null && raw['basket'] === basket && Array.isArray(raw['lines'])
        ? mapArray(raw['lines'], toStoredLine)
        : null;
    return { read, lines };
  }
}

/** One stored line, read back as untrusted as a response. */
function toStoredLine(raw: unknown): ShopMapLine | null {
  if (!isRecord(raw)) {
    return null;
  }
  const rowKey = str(raw['rowKey']);
  const content = str(raw['content']);
  const state = BASKET_ROW_STATES.find((one) => one === raw['state']);
  if (rowKey === null || content === null || state === undefined) {
    return null;
  }
  return {
    rowKey,
    content,
    quantity: numOr(raw['quantity'], 1),
    state: state as BasketRowState,
    sectionIds: mapArray(raw['sectionIds'], str),
  };
}
