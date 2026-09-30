/**
 * The shop map canvas (editor plan 0001): one SVG that draws a version 2
 * document in the mapper look or the shopper look, fits and zooms it, draws
 * the walk as it happens and, in the mapper look, draws, selects and resizes
 * areas. No framework and no chrome: every menu, sheet and word around it is
 * the host's, reached through the callbacks of `MountOptions`.
 */
export {
  PRODUCE_SECTION_WORDS,
  SHELF_UNIT_METRES,
  isProduceSection,
} from './lib/drawn';
export {
  HANDLE_HIT_PX,
  LONG_PRESS_MS,
  SLOP_PX,
  mountShopMap,
} from './lib/mount';
export { SHOP_MAP_PROPERTIES } from './lib/theme';
export type { ShopMapProperty } from './lib/theme';
export type {
  MountOptions,
  ShopMapBadge,
  ShopMapHandle,
  ShopMapLive,
  ShopMapLook,
  ShopMapPerson,
} from './lib/types';
export { MAX_PX_PER_METRE } from './lib/viewport';
