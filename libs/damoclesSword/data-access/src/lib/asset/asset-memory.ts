import { Injectable } from '@angular/core';
import { AssetKey } from './asset';
import { AssetServiceI } from './asset-service';

/**
 * Lazy loaders for every bundled data asset. Each `import()` is its own
 * code-split point, so an asset's bytes are only fetched the first time it is
 * requested.
 */
const ASSET_LOADERS: Record<AssetKey, () => Promise<string>> = {
  'vr-sickness-reducer-demo': () =>
    import('../../assets/vr-sickness-reducer-demo.mp4').then((m) => m.default),
  'realistic-interactor-demo': () =>
    import('../../assets/realistic-interactor-demo.mp4').then((m) => m.default),
  'starlit-ascension-trailer': () =>
    import('../../assets/starlit-ascension-trailer.mp4').then((m) => m.default),
  'starlit-logo': () =>
    import('../../assets/starlit-logo.avif').then((m) => m.default),
  'news-test-starlit': () =>
    import('../../assets/news/news-test-starlit.avif').then((m) => m.default),
  'news-win-game-jam': () =>
    import('../../assets/news/news-win-game-jam.png').then((m) => m.default),
};

/**
 * Resolves data-asset keys to bundled URLs. Reach for this only when an asset
 * is needed on its own (e.g. a logo rendered by a layout component): the data
 * services already return resolved asset URLs alongside their data, so callers
 * of a `getList()` never need it.
 */
@Injectable()
export class AssetMemory implements AssetServiceI {
  get(key: AssetKey) {
    return ASSET_LOADERS[key]();
  }
}
