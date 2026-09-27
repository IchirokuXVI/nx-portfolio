import { Injectable, signal } from '@angular/core';
import type { Track } from '@portfolio/luna-shopper/shop-map/recorder';

/** A plain GeoJSON import: tracks to look at, with no recording behind them. */
export interface ImportedTracks {
  fileName: string;
  tracks: Track[];
}

/**
 * What the lab's screens hand each other in memory.
 *
 * A tracks only import is viewable but is not a walk, so it is never saved (section
 * 7.1): the list puts it here and the viewer reads it back. It lives as long as the
 * lab's route, which is the only lifetime it needs.
 */
@Injectable()
export class WalkLabState {
  readonly imported = signal<ImportedTracks | null>(null);

  /** A sentence the list shows once on its next visit, such as a stopped recording. */
  readonly notice = signal<string | null>(null);
}
