import { inject, Injectable, signal } from '@angular/core';
import { toGatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * The shop a page is about, held once for the page and its tabs (admin plan
 * 0042).
 *
 * Provided by `ShopPage`, for the reason `ChainContext` is provided by the
 * chain's: the header, the "Priced by" line and the Sections tab all read the
 * same shop, and after the Details tab saves they must all say the same thing.
 */
@Injectable()
export class ShopContext {
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);

  private readonly _id = signal<string | null>(null);
  private readonly _shop = signal<Wire.CatalogSupermarketLocationView | null>(
    null
  );
  private readonly _status = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly _errorKey = signal<string | null>(null);

  private _generation = 0;

  readonly id = this._id.asReadonly();
  readonly shop = this._shop.asReadonly();
  readonly status = this._status.asReadonly();
  readonly errorKey = this._errorKey.asReadonly();

  async open(id: string): Promise<void> {
    this._generation += 1;
    this._id.set(id);
    this._shop.set(null);
    this._status.set('loading');
    this._errorKey.set(null);
    await this.reload();
  }

  async reload(): Promise<void> {
    const id = this._id();
    if (id === null) {
      return;
    }
    const generation = this._generation;

    try {
      const row = await this._shops().read(id);
      if (generation !== this._generation) {
        return;
      }
      this._shop.set(row as Wire.CatalogSupermarketLocationView);
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
   * Replace the scopes that price the shop. Throws what the gateway refused,
   * and the "Priced by" line says so.
   */
  async setPriceScopes(priceScopeIds: readonly string[]): Promise<void> {
    const id = this._id();
    if (id === null) {
      return;
    }

    const row = await this._shops().update(id, {
      priceScopeIds: [...priceScopeIds],
    });
    this._shop.set(row as Wire.CatalogSupermarketLocationView);
    this._changes.wrote('locations');
  }

  /** Delete the shop. Throws what the gateway refused. */
  async remove(): Promise<void> {
    const id = this._id();
    if (id === null) {
      return;
    }

    await this._shops().remove(id);
    this._changes.wrote('locations');
    // The chain counts its shops, and one of them is gone.
    this._changes.wrote('supermarkets');
  }

  private _shops() {
    const descriptor = this._registry.byName('locations');
    if (descriptor === undefined) {
      throw new Error('The shop page needs the locations resource.');
    }
    return this._registry.gatewayFor(descriptor);
  }
}
