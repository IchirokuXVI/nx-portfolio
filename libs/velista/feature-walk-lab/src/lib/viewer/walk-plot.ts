import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import type { WalkMark } from '@portfolio/luna-shopper/shop-map/recorder';
import type { ModeStyle } from './mode-style';
import {
  boundsOf,
  IDENTITY,
  panBy,
  pinch,
  thin,
  zoomAt,
  type Point,
  type View,
} from './viewport';

/** A track to draw, in metres on the floor with +y up. */
export interface PlotLine {
  id: string;
  points: readonly Point[];
  style: ModeStyle;
}

/** A mark placed on a track. */
export interface PlotMark {
  x: number;
  y: number;
  kind: WalkMark['kind'];
  label?: string;
}

/** A rectangle of the draft map, in metres with +y up, `(x, y)` its lower left. */
export interface PlotRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
}

/** Polylines are thinned to this many points; see `thin`. */
const MAX_DRAWN_POINTS = 3_000;

/** Grid lines per axis before the grid steps up to every fifth, then tenth, cell. */
const MAX_GRID_LINES = 160;

/**
 * The walk drawn as an SVG over a grid of `cellMetres` (recorder plan 0002, 7.3).
 *
 * The world is in metres with +y up; the SVG's y runs down, so every y is negated on
 * the way in. Strokes keep their width in screen pixels whatever the zoom, and marks
 * keep their size, so zooming in on a corner shows where the lines are rather than
 * making them fat.
 *
 * Pinch zoom and drag pan are pointer events, one pointer to pan and two to pinch,
 * with the arithmetic in `viewport.ts`. A mouse wheel zooms too, for a laptop.
 */
@Component({
  selector: 'lib-walk-plot',
  templateUrl: './walk-plot.html',
  styleUrl: './walk-plot.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalkPlot {
  readonly lines = input<readonly PlotLine[]>([]);
  readonly marks = input<readonly PlotMark[]>([]);
  readonly rects = input<readonly PlotRect[]>([]);
  readonly cellMetres = input(0.5);
  /** The accessible name of the drawing. */
  readonly label = input('');
  readonly fitLabel = input('');
  readonly zoomInLabel = input('');
  readonly zoomOutLabel = input('');

  private readonly _svg = viewChild<ElementRef<SVGSVGElement>>('svg');
  private readonly _view = signal<View>(IDENTITY);
  private readonly _size = signal({ width: 1, height: 1 });

  readonly view = this._view.asReadonly();

  readonly transform = computed(() => {
    const v = this._view();
    return `translate(${v.x} ${v.y}) scale(${v.scale})`;
  });

  /** The world box, in SVG units (y negated), with a margin. */
  readonly box = computed(() => {
    const points: Point[] = [{ x: 0, y: 0 }];
    for (const line of this.lines()) {
      for (const p of line.points) {
        points.push(p);
      }
    }
    for (const r of this.rects()) {
      points.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
    }
    const b = boundsOf(points, 6);
    const margin = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.06 + 1;
    return {
      x: b.minX - margin,
      y: -b.maxY - margin,
      w: b.maxX - b.minX + margin * 2,
      h: b.maxY - b.minY + margin * 2,
    };
  });

  readonly viewBox = computed(() => {
    const b = this.box();
    return `${b.x} ${b.y} ${b.w} ${b.h}`;
  });

  readonly drawnLines = computed(() =>
    this.lines().map((line) => ({
      id: line.id,
      style: line.style,
      d: toPoints(thin(line.points, MAX_DRAWN_POINTS)),
    }))
  );

  /** Grid lines over the box, stepping up to a coarser pitch when there are too many. */
  readonly grid = computed(() => {
    const b = this.box();
    const cell = this.cellMetres() > 0 ? this.cellMetres() : 0.5;
    // Pad the grid beyond the box so a pan does not run off its edge at once.
    const pad = Math.max(b.w, b.h);
    const x0 = b.x - pad;
    const x1 = b.x + b.w + pad;
    const y0 = b.y - pad;
    const y1 = b.y + b.h + pad;

    let pitch = cell;
    for (const factor of [1, 2, 5, 10, 20, 50, 100]) {
      pitch = cell * factor;
      if (Math.max(x1 - x0, y1 - y0) / pitch <= MAX_GRID_LINES * 3) {
        break;
      }
    }
    const major = pitch * 10;

    const minor: string[] = [];
    const majors: string[] = [];
    for (let x = Math.ceil(x0 / pitch) * pitch; x <= x1; x += pitch) {
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      (isMajor ? majors : minor).push(`M${round(x)} ${round(y0)}V${round(y1)}`);
    }
    for (let y = Math.ceil(y0 / pitch) * pitch; y <= y1; y += pitch) {
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      (isMajor ? majors : minor).push(`M${round(x0)} ${round(y)}H${round(x1)}`);
    }
    return { minor: minor.join(''), major: majors.join('') };
  });

  /** Screen pixels per SVG unit. `preserveAspectRatio` meet applies the smaller ratio. */
  private readonly _pxPerUnit = computed(() => {
    const box = this.box();
    const size = this._size();
    return Math.max(1e-6, Math.min(size.width / box.w, size.height / box.h));
  });

  /** A mark's radius in world units, so it stays the same size on screen. */
  readonly markRadius = computed(
    () => 9 / (this._pxPerUnit() * this._view().scale)
  );
  readonly labelSize = computed(
    () => 13 / (this._pxPerUnit() * this._view().scale)
  );

  private readonly _pointers = new Map<number, Point>();

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const svg = this._svg()?.nativeElement;
      if (!svg) {
        return;
      }
      const measure = () =>
        this._size.set({
          width: svg.clientWidth || 1,
          height: svg.clientHeight || 1,
        });
      measure();
      const ResizeObserverCtor = svg.ownerDocument.defaultView?.ResizeObserver;
      if (ResizeObserverCtor) {
        const observer = new ResizeObserverCtor(measure);
        observer.observe(svg);
        destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  /** Back to the whole walk. */
  fit(): void {
    this._view.set(IDENTITY);
  }

  zoom(factor: number): void {
    const b = this.box();
    this._view.update((v) => zoomAt(v, factor, b.x + b.w / 2, b.y + b.h / 2));
  }

  onPointerDown(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer cannot be captured, and does not need to be.
    }
    this._pointers.set(event.pointerId, this._toSvg(svg, event));
  }

  onPointerMove(event: PointerEvent): void {
    if (!this._pointers.has(event.pointerId)) {
      return;
    }
    const svg = event.currentTarget as SVGSVGElement;
    const next = this._toSvg(svg, event);

    if (this._pointers.size === 1) {
      const prev = this._pointers.get(event.pointerId) as Point;
      this._view.update((v) => panBy(v, next.x - prev.x, next.y - prev.y));
      this._pointers.set(event.pointerId, next);
      return;
    }

    const ids = [...this._pointers.keys()].slice(0, 2);
    if (!ids.includes(event.pointerId)) {
      return;
    }
    const before = ids.map((id) => this._pointers.get(id) as Point) as [
      Point,
      Point,
    ];
    this._pointers.set(event.pointerId, next);
    const after = ids.map((id) => this._pointers.get(id) as Point) as [
      Point,
      Point,
    ];
    this._view.update((v) => pinch(v, before, after));
  }

  onPointerUp(event: PointerEvent): void {
    this._pointers.delete(event.pointerId);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const svg = event.currentTarget as SVGSVGElement;
    const at = this._toSvg(svg, event);
    this._view.update((v) =>
      zoomAt(v, Math.exp(-event.deltaY * 0.0015), at.x, at.y)
    );
  }

  /** Client pixels to SVG units, through the SVG's own screen matrix. */
  private _toSvg(svg: SVGSVGElement, event: MouseEvent): Point {
    const matrix = svg.getScreenCTM?.();
    if (!matrix) {
      return { x: event.clientX, y: event.clientY };
    }
    const inverse = matrix.inverse();
    return {
      x: inverse.a * event.clientX + inverse.c * event.clientY + inverse.e,
      y: inverse.b * event.clientX + inverse.d * event.clientY + inverse.f,
    };
  }
}

function toPoints(points: readonly Point[]): string {
  let out = '';
  for (const p of points) {
    out += `${round(p.x)},${round(-p.y)} `;
  }
  return out;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
