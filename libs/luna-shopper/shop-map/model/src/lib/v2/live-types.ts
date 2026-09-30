import type { MapMark, ShopMapDocumentV2, WalkEvent } from './types';

/**
 * The live map of shop-map plan 0003: the state machine that turns a walk,
 * one tracked point or one mark at a time, into walked cells, shelf
 * suggestions, the section run in progress and the events for the walk log.
 */

/** The tracking state of `recorder/plans/0003`. Nothing is painted unless it is `good`. */
export type LiveTracking = 'good' | 'lost' | 'suspect';

/** One tracked position, in metres in the walk's frame, at a log time. */
export interface LivePoint {
  logMs: number;
  x: number;
  y: number;
}

export interface LiveMapSettings {
  /** Ids of the areas the live map makes are `${idPrefix}${n}`, n counting up from `idSeed`. */
  idPrefix: string;
  /** The first n. 1 by default. */
  idSeed?: number;
  /** Walking across a suggested shelf turns it back into path. One setting for every walk, true by default. */
  walkingAcrossMakesPath?: boolean;
}

export interface LiveMapOptions {
  /** The map as the walk left it, for example `foldWalk` of the log so far. */
  document: ShopMapDocumentV2;
  settings: LiveMapSettings;
}

/** Section 2: what a snapshot answers. */
export interface LiveSnapshot {
  /** Cell indices at 0.5 m: cell (x, y) covers [x·0.5, (x+1)·0.5) metres, and the same along y. */
  walkedCells: { x: number; y: number }[];
  /** Metres, snapped to the cells they cover. Computed, never stored. */
  suggestions: { id: string; x: number; y: number; w: number; h: number }[];
  /** "In section X": the section in progress and the area it fills. */
  sectionRun: { section: string; areaId: string } | null;
  /** The events produced since the last snapshot, ready for the log. */
  events: WalkEvent[];
}

export interface LiveMapHandle {
  /** A tracked point. It paints only while tracking is `good`. */
  push(point: LivePoint): void;
  setTracking(state: LiveTracking): void;
  /** A mark the person saved, with the heading the phone faced. */
  mark(mark: MapMark): void;
  /** "Section left": ends the section run in progress. */
  sectionLeft(): void;
  /** Fills a suggestion as a shelf. */
  acceptSuggestion(id: string): void;
  /** Hides a suggestion for the rest of the walk. */
  dismissSuggestion(id: string): void;
  snapshot(): LiveSnapshot;
}
