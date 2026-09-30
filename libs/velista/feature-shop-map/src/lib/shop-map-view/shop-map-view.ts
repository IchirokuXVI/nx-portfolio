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
  type ShopMapLook,
} from '@portfolio/luna-shopper/shop-map/editor';
import type {
  ShopMapDocumentV2,
  WalkEntry,
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
      });
      this._handle.setBadges({ ...untracked(this.badges) });
      const faded = untracked(this.fadedAfter);
      if (faded !== null) {
        this._handle.setFadedAfter(faded.logMs, faded.log);
      }
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
      const badges = this.badges();
      untracked(() => this._handle?.setBadges({ ...badges }));
    });

    inject(DestroyRef).onDestroy(() => {
      this._handle?.destroy();
      this._handle = null;
    });
  }

  /** Fit the whole map in view again. */
  fit(): void {
    this._handle?.fitToContent();
  }
}
