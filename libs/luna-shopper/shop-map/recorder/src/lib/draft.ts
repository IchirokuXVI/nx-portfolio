import type { ShopMapDocument } from './shop-map-document';
import type { Track } from './track-types';
import type { Walk } from './walk';
import type { WalkFile } from './walk-file';

export interface WalkToDocumentOptions {
  size?: { cols: number; rows: number };
  outline?: ShopMapDocument['outline'];
  /** Which side a scanned product sits on, 'right' by default. */
  hand?: 'right' | 'left';
}

export function walkToDocument(
  walk: Walk,
  options: WalkToDocumentOptions = {}
): ShopMapDocument {
  void walk;
  void options;
  throw new Error('not implemented');
}

export function trackToWalk(walk: WalkFile, track: Track): Walk {
  void walk;
  void track;
  throw new Error('not implemented');
}
