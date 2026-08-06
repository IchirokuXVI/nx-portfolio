import { AssetKey } from './asset';

export interface AssetServiceI {
  /** Resolves a bundled data-asset key to its (lazily loaded) URL. */
  get(key: AssetKey): Promise<string>;
}
