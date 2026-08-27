import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import { AssetKey } from './asset';
import { AssetMemory } from './asset-memory';

export interface AssetServiceI {
  /** Resolves a bundled data-asset key to its (lazily loaded) URL. */
  get(key: AssetKey): Promise<string>;
}

/**
 * DI token for the asset resolver, defaulting to the in-memory implementation.
 * Inject this instead of the concrete `AssetMemory`.
 */
export const ASSET_SERVICE = serviceToken<AssetServiceI>('ASSET_SERVICE', () =>
  inject(AssetMemory)
);
