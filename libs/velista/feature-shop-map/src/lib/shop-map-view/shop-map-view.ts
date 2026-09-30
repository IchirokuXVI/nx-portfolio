import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import {
  mountShopMap,
  type ShopMapHandle,
  type ShopMapLive,
  type ShopMapLook,
} from '@portfolio/luna-shopper/shop-map/editor';
import type {
  AreaKind,
  MapArea,
  ShopMapDocumentV2,
  WalkEntry,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import type { ShopMapBadgeCount } from '@portfolio/velista/models';
import { ThemeStore } from '@portfolio/velista/platform';

/**
 * The shared shop map canvas in the shopper look, as velista mounts it (velista
 * `0121`, target 3; editor plan 0001, the adapter rule).
 *
 * The canvas is framework free and draws nothing a person reads but the map, so
 * this is the whole of the Angular side: a sized host, the document, the badges,
 * and the tap on a section coming back out. Every colour it can take from
 * velista's tokens is set on the host (see the stylesheet), and the theme is
 * velista's own, bound on the host, because the canvas would otherwise follow the
 * system's rather than the one somebody chose in the app.
 *
 * The canvas fits the map on mount and keeps it fitted until somebody zooms.
 */
@Component({
  selector: 'lib-shop-map-view',
  template: `<div #canvas class="canvas"></div>`,
  styleUrl: './shop-map-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-theme]': 'theme()',
    role: 'group',
    '[attr.aria-label]': 'label()',
  },
})
export class ShopMapView {
  /** The map, rebuilt from what the server sent (see `shopMapDocumentOf`). */
  readonly document = input.required<ShopMapDocumentV2>();

  /** Badges by the name each area spells its section with. Empty draws none. */
  readonly badges = input<Readonly<Record<string, ShopMapBadgeCount>>>({});

  /** What a screen reader calls the map. */
  readonly label = input('');

  /**
   * The shopper's friendly map, or the mapper's (velista `0122`): the walked
   * floor, the grid, every mark. Chosen when the canvas mounts and followed after.
   */
  readonly look = input<ShopMapLook>('shopper');

  /**
   * The mapper look's rewind preview: everything after this point of the log
   * drawn faded, which the canvas works out from the log (`setFadedAfter`). Null
   * fades nothing.
   */
  readonly fadedAfter = input<{
    readonly logMs: number;
    readonly log: readonly WalkEntry[];
  } | null>(null);

  /**
   * A section's area was tapped: the name its area spells the section with.
   * Named for what happened rather than `select`, which is a DOM event.
   */
  readonly sectionTapped = output<string>();

  /**
   * Mapper look (velista `0123`): whether a drawn or resized corner snaps to the
   * half metre squares. Off unless the page turns it on.
   */
  readonly snap = input(false);

  /** Mapper look: the kind a drag on the floor draws. */
  readonly drawKind = input<AreaKind>('shelf');

  /** Mapper look: the size shown beside a selected area, in the app's words. */
  readonly sizeLabel = input<((w: number, h: number) => string) | null>(null);

  /**
   * Mapper look, while recording (velista `0126`): the walk as it happens, the
   * walked floor, the suggestions, the person and the purple path. The page
   * passes a new value at most ten times a second.
   */
  readonly live = input<ShopMapLive | null>(null);

  /** Mapper look: the words on a shelf suggestion, read when the canvas mounts. */
  readonly suggestionLabel = input<string | null>(null);

  /** Mapper look: a shelf suggestion was tapped, by its id. */
  readonly suggestionTapped = output<string>();

  /** Mapper look: a finished draw, move or resize, as walk events. */
  readonly changed = output<WalkEvent[]>();

  /** Mapper look: an area was tapped or drawn, or the selection was cleared. */
  readonly areaSelected = output<MapArea | null>();

  /** Mapper look: a long press, with the point in metres and what is under it. */
  readonly longPressed = output<{
    readonly at: { readonly x: number; readonly y: number };
    readonly area: MapArea | null;
    readonly client: { readonly x: number; readonly y: number };
  }>();

  protected readonly theme = inject(ThemeStore).theme;

  private readonly _canvas =
    viewChild.required<ElementRef<HTMLElement>>('canvas');

  private _handle: ShopMapHandle | null = null;

  constructor() {
    afterNextRender(() => {
      this._handle = mountShopMap(this._canvas().nativeElement, {
        document: untracked(this.document),
        look: untracked(this.look),
        onSection: (section) => this.sectionTapped.emit(section),
        onChange: (events) => this.changed.emit(events),
        onSelect: (area) => this.areaSelected.emit(area),
        onLongPress: (at, area, client) =>
          this.longPressed.emit({ at, area, client }),
        onSuggestion: (id) => this.suggestionTapped.emit(id),
        ...(untracked(this.suggestionLabel) !== null
          ? { suggestionLabel: untracked(this.suggestionLabel) ?? undefined }
          : {}),
        sizeLabel: (w, h) =>
          untracked(this.sizeLabel)?.(w, h) ??
          `${Math.round(w * 100) / 100} m × ${Math.round(h * 100) / 100} m`,
      });
      this._handle.setSnap(untracked(this.snap));
      this._handle.setDrawKind(untracked(this.drawKind));
      this._handle.setBadges({ ...untracked(this.badges) });
      const faded = untracked(this.fadedAfter);
      if (faded !== null) {
        this._handle.setFadedAfter(faded.logMs, faded.log);
      }
      const live = untracked(this.live);
      if (live !== null) {
        this._handle.setLive(live);
      }
    });

    effect(() => {
      const live = this.live();
      untracked(() => this._handle?.setLive(live));
    });

    effect(() => {
      const look = this.look();
      untracked(() => this._handle?.setLook(look));
    });

    effect(() => {
      const faded = this.fadedAfter();
      untracked(() =>
        this._handle?.setFadedAfter(faded?.logMs ?? null, faded?.log)
      );
    });

    effect(() => {
      const document = this.document();
      untracked(() => this._handle?.setDocument(document));
    });

    effect(() => {
      const snap = this.snap();
      untracked(() => this._handle?.setSnap(snap));
    });

    effect(() => {
      const kind = this.drawKind();
      untracked(() => this._handle?.setDrawKind(kind));
    });

    effect(() => {
      const badges = this.badges();
      untracked(() => this._handle?.setBadges({ ...badges }));
    });

    inject(DestroyRef).onDestroy(() => {
      this._handle?.destroy();
      this._handle = null;
    });
  }

  /** Mapper look: select an area, or clear the selection. */
  select(areaId: string | null): void {
    this._handle?.setSelected(areaId);
  }

  /** Mapper look: drop the pressed square after a menu closed with no action. */
  clearHeld(): void {
    this._handle?.clearHeld();
  }

  /**
   * Mapper look: which of the document's marks has its pin under a point of the
   * screen, as an index into `document().marks`, or null. The canvas draws one pin
   * per mark in the document's order and reports no tap on one, so the pins are
   * found by what they draw (a round pin or a note square) and measured on screen.
   * A pin counts within `reach` css pixels of its centre.
   */
  markAt(client: { x: number; y: number }, reach = 30): number | null {
    const host = this._canvas().nativeElement;
    const pins = Array.from(host.querySelectorAll('g')).filter((g) =>
      g.firstElementChild?.matches('circle.sm-pin, rect.sm-note')
    );
    if (pins.length !== this.document().marks.length) {
      return null;
    }
    let best: number | null = null;
    let bestDistance = reach;
    pins.forEach((pin, index) => {
      const box = pin.getBoundingClientRect();
      const distance = Math.hypot(
        box.left + box.width / 2 - client.x,
        box.top + box.height / 2 - client.y
      );
      if (distance <= bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }

  /** Fit the whole map in view again. */
  fit(): void {
    this._handle?.fitToContent();
  }
}
