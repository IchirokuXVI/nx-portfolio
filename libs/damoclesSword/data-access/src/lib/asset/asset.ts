/**
 * Identifies a bundled data asset (news / project media). The asset files live
 * in this data-access library (`src/assets`), and
 * {@link ./asset-memory#AssetMemory} resolves each key to a URL. The same asset
 * is served for every locale.
 */
export type AssetKey =
  // projects
  | 'vr-sickness-reducer-demo'
  | 'realistic-interactor-demo'
  | 'starlit-ascension-trailer'
  | 'starlit-logo'
  // news
  | 'news-test-starlit'
  | 'news-win-game-jam';
