import type { ShopMapDocumentV2, WalkEntry, WalkOrderV2 } from '../v2/types';
import expectedDocument from './el-jamon/expected-map.json';
import expectedWalkOrder from './el-jamon/expected-walk-order.json';
import walkLog from './el-jamon/walk-log.json';

/**
 * The second El Jamón walk of 2026-09-29 reduced to a walk log by
 * `tools/shop-map/reduce-el-jamon-walk.ts`: the camera path at one point per
 * second and its 57 marks, the tracking stop at 920.5 s with the turned
 * segment after it discarded, a manual resume, two rewinds (the second past
 * the first, over a replay of the tail) and one edit that draws the areas.
 */
export const elJamonLog = walkLog.entries as WalkEntry[];

/** Wall times of the stop, read from the walk file. */
export const elJamonStop = walkLog.stop;

/** What the log folds to, normalized. */
export const elJamonDocument = expectedDocument as ShopMapDocumentV2;

/** The walk order of that map. */
export const elJamonWalkOrder = expectedWalkOrder as WalkOrderV2;
