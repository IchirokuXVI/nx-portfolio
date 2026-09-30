import type {
  AreaKind,
  LiveSnapshot,
  MapArea,
  ShopMapDocumentV2,
  WalkEntry,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';

/**
 * The looks of editor plan 0001, section 2, and the drawn shopper look of
 * velista plan 0128: the shopper look with shelves, counters, crates, tills
 * and the door drawn, and every label on a tag. It taps, badges and labels
 * as the shopper look does.
 */
export type ShopMapLook = 'mapper' | 'shopper' | 'shopper-drawn';

/** Where the walker is, in metres, with the heading convention of the model. */
export interface ShopMapPerson {
  x: number;
  y: number;
  /** Degrees: the direction faced is `(-sin h, cos h)` with +y drawn downwards. */
  heading: number;
}

/** What `setLive` draws in the mapper look. */
export interface ShopMapLive {
  snapshot: LiveSnapshot;
  person?: ShopMapPerson;
  /** The purple path after an automatic resume, as `[x, y]` metres. */
  unconfirmed?: [number, number][];
}

/** One section's badge in the shopper look. */
export interface ShopMapBadge {
  count: number;
  done: boolean;
}

export interface ShopMapHandle {
  setDocument(doc: ShopMapDocumentV2): void;
  setLook(look: ShopMapLook): void;
  /** Mapper look: the walk as it happens. */
  setLive(live: ShopMapLive | null): void;
  /**
   * Mapper look, rewind preview: draw everything after this log time faded.
   * Marks carry their own log time. Areas and the walked floor carry none, so
   * pass the walk log as well and the parts `stateAt(log, logMs)` does not
   * hold are faded too.
   */
  setFadedAfter(logMs: number | null, log?: readonly WalkEntry[]): void;
  /** Shopper look: badges per section name. */
  setBadges(badges: Record<string, ShopMapBadge>): void;
  setSelected(areaId: string | null): void;
  /**
   * Mapper look: removes the square a long press marks. The next touch, any
   * `setDocument` (also one from a live walk while the menu is open) and a
   * `setSelected` of an area other than the pressed one remove it too, so the host calls
   * this only when its menu is dismissed without an action.
   */
  clearHeld(): void;
  setSnap(on: boolean): void;
  /** Mapper look: the kind a tap and drag on the floor draws. */
  setDrawKind(kind: AreaKind): void;
  fitToContent(): void;
  destroy(): void;
}

export interface MountOptions {
  document: ShopMapDocumentV2;
  look: ShopMapLook;
  labelOf?: (area: MapArea) => string;
  /** Mapper look: an area was tapped, or the selection was cleared. */
  onSelect?: (area: MapArea | null) => void;
  /** Mapper look: a finished draw, move or resize, as log events. */
  onChange?: (events: WalkEvent[]) => void;
  /**
   * Mapper look: a long press, with the area under it and the point in metres.
   * A press on a resize handle reports the selected area it belongs to.
   * The pressed square stays marked while the host's menu is open. Selecting
   * the pressed area keeps it. Any `setDocument` removes it, including one
   * that arrives from a live walk while the menu is open.
   */
  onLongPress?: (
    at: { x: number; y: number },
    area: MapArea | null,
    client: { x: number; y: number }
  ) => void;
  /** Mapper look: a suggestion was tapped. The host asks, then calls the live map. */
  onSuggestion?: (id: string) => void;
  /** Shopper look: a section's area was tapped. */
  onSection?: (section: string) => void;
  /**
   * The id of an area drawn by hand. The library never invents one unless
   * this is left out, and then it uses `crypto.randomUUID()`.
   */
  createId?: () => string;
  /** The words on a shelf suggestion. `Shelf?` when left out. */
  suggestionLabel?: string;
  /** The size shown while an area is selected. `2.8 m × 1.4 m` when left out. */
  sizeLabel?: (w: number, h: number) => string;
}
