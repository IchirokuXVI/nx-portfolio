import { inject, Injectable, signal } from '@angular/core';
import {
  HARVEST_SERVICE,
  toGatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { ShopSections } from '../shop-sections';

/** What the harvester has for a chain. */
export type ChainSourceState =
  /** A source exists and may be fetched. */
  | 'fetched'
  /** A source exists and its switch is off. */
  | 'off'
  /** No source: every price of this chain is typed by a person. */
  | 'none';

/**
 * How many price scopes a count will read before it gives up.
 *
 * A chain's general scopes are a handful. A chain with a single shop scope per
 * shop has as many as it has shops, and the list has no total, so past one
 * page the tab shows no number and not a number that is too small.
 */
const SCOPE_COUNT_PAGE = 100;

/**
 * The chain a page is about, held once for the page and every tab under it
 * (admin plan 0042).
 *
 * Provided by `ChainPage`, so it lives exactly as long as a chain is open. The
 * header reads the name from it, the tabs read their counts from it, and the
 * Price scopes tab asks it which scope is the default and tells it to change
 * that. Without it each of those would read the chain for itself, and after a
 * write they would disagree until the next reload.
 *
 * **A count is shown only when the gateway gave it.** The shop count comes on
 * the chain. The section count is the length of a list that is read whole.
 * The scope count is the length of the first page when that page is the last,
 * and nothing otherwise.
 */
@Injectable()
export class ChainContext {
  private readonly _registry = inject(ResourceRegistry);
  private readonly _sections = inject(ShopSections);
  private readonly _harvest = inject(HARVEST_SERVICE);
  private readonly _changes = inject(ResourceChanges);

  private readonly _id = signal<string | null>(null);
  private readonly _chain = signal<Wire.CatalogSupermarketView | null>(null);
  private readonly _status = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly _errorKey = signal<string | null>(null);
  private readonly _sectionCount = signal<number | null>(null);
  private readonly _scopeCount = signal<number | null>(null);
  private readonly _source = signal<ChainSourceState | null>(null);

  /** So that an answer for a chain the page has left is dropped. */
  private _generation = 0;

  readonly id = this._id.asReadonly();
  readonly chain = this._chain.asReadonly();
  readonly status = this._status.asReadonly();
  /** Why the chain could not be read, as a key. */
  readonly errorKey = this._errorKey.asReadonly();
  /** The sections of the chain, or `null` until they are read. */
  readonly sectionCount = this._sectionCount.asReadonly();
  /** The price scopes of the chain, or `null` when the list has more pages. */
  readonly scopeCount = this._scopeCount.asReadonly();
  /** What the harvester has for the chain, or `null` when it did not answer. */
  readonly source = this._source.asReadonly();

  /** Open a chain. Everything the page shows is read again. */
  async open(id: string): Promise<void> {
    this._generation += 1;
    this._id.set(id);
    this._chain.set(null);
    this._status.set('loading');
    this._errorKey.set(null);
    this._sectionCount.set(null);
    this._scopeCount.set(null);
    this._source.set(null);
    await this.reload();
  }

  /** Read the chain and its counts again, keeping what is on screen meanwhile. */
  async reload(): Promise<void> {
    const id = this._id();
    if (id === null) {
      return;
    }
    const generation = this._generation;

    // The three around the chain fail by themselves: a count that could not
    // be read is a tab without a number, and never a page that will not open.
    void this._readSectionCount(id, generation);
    void this._readScopeCount(id, generation);
    void this._readSource(id, generation);

    try {
      const row = await this._chains().read(id);
      if (generation !== this._generation) {
        return;
      }
      this._chain.set(row as Wire.CatalogSupermarketView);
      this._status.set('ready');
    } catch (error) {
      if (generation !== this._generation) {
        return;
      }
      this._errorKey.set(
        gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
      );
      this._status.set('error');
    }
  }

  /**
   * Make one of the chain's scopes its default.
   *
   * A write to the chain, so it throws what the gateway refused and the list
   * that asked says so on the row.
   */
  async setDefaultScope(priceScopeId: string): Promise<void> {
    const id = this._id();
    if (id === null) {
      return;
    }

    const row = await this._chains().update(id, {
      defaultPriceScopeId: priceScopeId,
    });
    this._chain.set(row as Wire.CatalogSupermarketView);
    this._changes.wrote('supermarkets');
  }

  /** Delete the chain. Throws what the gateway refused. */
  async remove(): Promise<void> {
    const id = this._id();
    if (id === null) {
      return;
    }

    await this._chains().remove(id);
    this._changes.wrote('supermarkets');
  }

  private _chains() {
    const descriptor = this._registry.byName('supermarkets');
    if (descriptor === undefined) {
      throw new Error('The chain page needs the supermarkets resource.');
    }
    return this._registry.gatewayFor(descriptor);
  }

  private async _readSectionCount(id: string, generation: number) {
    try {
      const sections = await this._sections.chainSections(id);
      if (generation === this._generation) {
        this._sectionCount.set(sections.length);
      }
    } catch {
      if (generation === this._generation) {
        this._sectionCount.set(null);
      }
    }
  }

  private async _readScopeCount(id: string, generation: number) {
    const descriptor = this._registry.byName('price-scopes');
    if (descriptor === undefined) {
      return;
    }

    try {
      const page = await this._registry.gatewayFor(descriptor).list({
        limit: SCOPE_COUNT_PAGE,
        filters: { supermarketId: id },
      });
      if (generation === this._generation) {
        this._scopeCount.set(
          page.nextCursor === null ? page.items.length : null
        );
      }
    } catch {
      if (generation === this._generation) {
        this._scopeCount.set(null);
      }
    }
  }

  private async _readSource(id: string, generation: number) {
    try {
      const source = await this._harvest.readSource(id);
      if (generation === this._generation) {
        this._source.set(source.enabled ? 'fetched' : 'off');
      }
    } catch (error) {
      if (generation === this._generation) {
        // Not found is an answer: the chain has no source. Anything else is
        // the harvester not answering, and the header then says nothing.
        this._source.set(toGatewayError(error).status === 404 ? 'none' : null);
      }
    }
  }
}
