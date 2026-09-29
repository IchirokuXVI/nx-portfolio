/**
 * The shop map document (shop-map plan 0001) and everything that can be
 * computed from it without a screen: its rules, the walkable grid, distances,
 * the walk order, templates and normalization.
 *
 * Framework free by hard constraint: no DOM, no framework and no runtime
 * dependency, so the same code runs in the backend, the back office, velista
 * and the recorder. Nothing here invents an id; callers give them.
 */

export {
  DEFAULT_CELL_METRES,
  EMPTY_ENTRANCE_ID,
  emptyShopMap,
} from './lib/empty';
export {
  anchorFace,
  distancesFrom,
  isBlocking,
  walkableGrid,
} from './lib/grid';
export type { ShopMapGrid } from './lib/grid';
export { normalizeShopMap } from './lib/normalize';
export { fitOutline } from './lib/outline';
export type { FittedOutline, MetricOutline } from './lib/outline';
export { parallelAisles } from './lib/templates';
export type {
  AnchorFace,
  AnchorKind,
  FixtureKind,
  ShopMapAnchor,
  ShopMapCell,
  ShopMapDocument,
  ShopMapFixture,
  ShopMapProblem,
  ShopMapProblemCode,
  WalkOrder,
} from './lib/types';
export { PROBLEM_ORDER, validateShopMap } from './lib/validate';
export { walkOrder } from './lib/walk-order';

/**
 * Version 2 (shop-map plan 0002): the document in metres, the walk log that
 * folds to it, the walk order over it and what a shopper is shown. Every new
 * piece reads and writes this one; nothing new reads version 1.
 */
export { normalizeShopMapV2 } from './lib/v2/normalize';
export { shopperView } from './lib/v2/shopper-view';
export type {
  AreaColour,
  AreaKind,
  AreaOrigin,
  MapArea,
  MapMark,
  MarkKind,
  ShopMapDocumentV2,
  ShopMapProblemCodeV2,
  ShopMapProblemV2,
  ShopperArea,
  ShopperNote,
  ShopperView,
  WalkEntry,
  WalkEntryKind,
  WalkEvent,
  WalkOrderV2,
  WalkTimelineMarker,
} from './lib/v2/types';
export { PROBLEM_ORDER_V2, validateShopMapV2 } from './lib/v2/validate';
export { foldWalk, stateAt, walkTimeline } from './lib/v2/walk-log';
export { walkOrderV2 } from './lib/v2/walk-order';
