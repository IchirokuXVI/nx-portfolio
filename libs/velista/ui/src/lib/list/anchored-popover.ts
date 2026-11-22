import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedOverlayPositionChange,
  type ConnectedPosition,
  type FlexibleConnectedPositionStrategyOrigin,
} from '@angular/cdk/overlay';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';

/** Why an {@link AnchoredPopover} asked to close. */
export type AnchoredPopoverClose = 'escape' | 'outside' | 'detach';

/** Which edge of the anchor the popover lines up with, or its middle. */
export type AnchoredPopoverAlign = 'start' | 'end' | 'center';

/** Which side of the anchor the popover tries first. */
export type AnchoredPopoverSide = 'above' | 'below';

/**
 * Its frame. `note` holds sentences and controls inside a padding. `choice` holds
 * rows that reach its edges, at the width the add choice was drawn to (velista
 * `0170`). `hint` holds one short sentence at the width of its words (the stepper's
 * refused key, velista `0188`).
 */
export type AnchoredPopoverFrame = 'note' | 'choice' | 'hint';

/**
 * Above the anchor and aligned with its start edge, since the anchors this is drawn
 * against sit at the foot of the screen and the room is upward; below it when the
 * anchor is near the top.
 */
const START: ConnectedPosition[] = [
  {
    originX: 'start',
    originY: 'top',
    overlayX: 'start',
    overlayY: 'bottom',
    offsetX: 12,
    offsetY: -8,
  },
  {
    originX: 'start',
    originY: 'bottom',
    overlayX: 'start',
    overlayY: 'top',
    offsetX: 12,
    offsetY: 8,
  },
];

/**
 * The same two places, lined up with the anchor's end edge instead (velista
 * `0116`). An anchor at the trailing edge of the screen, like the composer's plus or
 * a card's add button, has no room after its start edge for a popover this wide.
 */
const END: ConnectedPosition[] = [
  {
    originX: 'end',
    originY: 'top',
    overlayX: 'end',
    overlayY: 'bottom',
    offsetY: -8,
  },
  {
    originX: 'end',
    originY: 'bottom',
    overlayX: 'end',
    overlayY: 'top',
    offsetY: 8,
  },
];

/**
 * The same two places over the anchor's middle (velista `0188`): a hint about the
 * field in the middle of the stepper reads as the field's own.
 */
const CENTER: ConnectedPosition[] = [
  {
    originX: 'center',
    originY: 'top',
    overlayX: 'center',
    overlayY: 'bottom',
    offsetY: -8,
  },
  {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetY: 8,
  },
];

/**
 * How far a pushed popover keeps from the screen's edges: the `--app-space-4` that
 * its widest frame already leaves on each side.
 */
const VIEWPORT_MARGIN = 16;

/**
 * How far a popover with a pointer keeps off the edge of what it must not cover
 * (velista `0206`): 12 px, as the board `compact-reel/OverBought.dc.html` draws it,
 * so the pointer's tip lands 3 to 4 px off that edge. The pointer's own size and
 * how far it stands out are in `anchored-popover.scss`.
 */
const POINTER_GAP = 12;

/** A box on the screen, in the viewport's pixels. */
interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

type Origin = CdkOverlayOrigin | FlexibleConnectedPositionStrategyOrigin;

/** The element an origin stands for, when it is one. A point has none. */
function elementOf(origin: Origin): Element | null {
  if (origin instanceof CdkOverlayOrigin) {
    return origin.elementRef.nativeElement;
  }
  if (origin instanceof ElementRef) {
    return origin.nativeElement as Element;
  }
  if (origin instanceof Element) {
    return origin;
  }
  return null;
}

/** Where an origin is on the screen now. */
function boxOf(origin: Origin): Box {
  const element = elementOf(origin);
  if (element) {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }
  const point = origin as {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
  return {
    left: point.x,
    top: point.y,
    width: point.width ?? 0,
    height: point.height ?? 0,
  };
}

/**
 * The two places of a popover with a pointer (velista `0206`): wholly above or
 * wholly below, `POINTER_GAP` off the element it keeps in sight, or off the anchor
 * when there is none. The places stay held against the anchor, so the popover is
 * still inserted right after it and the keyboard reaches it next. A row to keep in
 * sight turns into offsets: the distance from the anchor's edge to the row's edge
 * is added to the gap, and `end` lines up with the row's end, as the board draws
 * it. `start` and `center` keep their meaning against the anchor.
 */
function pointedPositions(
  align: AnchoredPopoverAlign,
  side: AnchoredPopoverSide,
  anchor: Box,
  row: Box | null
): ConnectedPosition[] {
  const x: Pick<ConnectedPosition, 'originX' | 'overlayX' | 'offsetX'> =
    align === 'end'
      ? {
          originX: 'end',
          overlayX: 'end',
          offsetX: row
            ? row.left + row.width - (anchor.left + anchor.width)
            : 0,
        }
      : align === 'center'
        ? { originX: 'center', overlayX: 'center' }
        : { originX: 'start', overlayX: 'start', offsetX: START[0].offsetX };
  const over = row ? anchor.top - row.top : 0;
  const under = row ? row.top + row.height - (anchor.top + anchor.height) : 0;
  const above: ConnectedPosition = {
    ...x,
    originY: 'top',
    overlayY: 'bottom',
    offsetY: -(over + POINTER_GAP),
  };
  const below: ConnectedPosition = {
    ...x,
    originY: 'bottom',
    overlayY: 'top',
    offsetY: under + POINTER_GAP,
  };
  return side === 'below' ? [below, above] : [above, below];
}

/** Two position lists that say the same thing, so a scroll hands the overlay nothing new. */
function samePositions(
  a: ConnectedPosition[],
  b: ConnectedPosition[]
): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A small popover held against an element on the page, with whatever the container
 * puts in it (velista `0110`).
 *
 * One popover's wiring, made into a component so a second popover is not a second
 * copy of it: a CDK connected overlay drawn as an
 * **inline** native popover, so it sits in the top layer above a clipping or sticky
 * container and still inherits the app's tokens, and it is inserted in the document
 * right after its anchor, so the keyboard reaches its controls next.
 *
 * It owns no state. The container says whether it is open and hears why it wants to
 * close: a press anywhere outside it, Escape, or the overlay being taken down. The
 * container decides what happens to focus, because only the container knows where it
 * was.
 */
@Component({
  selector: 'lib-anchored-popover',
  imports: [CdkConnectedOverlay, NgTemplateOutlet],
  template: `
    <ng-template
      (detach)="closed.emit('detach')"
      (overlayKeydown)="onKey($event)"
      (overlayOutsideClick)="closed.emit('outside')"
      (positionChange)="onPosition($event)"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayOrigin]="origin()"
      [cdkConnectedOverlayPositions]="positions()"
      [cdkConnectedOverlayPush]="push() && !pointer()"
      [cdkConnectedOverlayUsePopover]="'inline'"
      [cdkConnectedOverlayViewportMargin]="
        push() || pointer() ? viewportMargin : 0
      "
      cdkConnectedOverlay
    >
      <div
        [attr.aria-labelledby]="labelledBy()"
        [attr.role]="role()"
        [class.accent]="accent()"
        [class.choice]="frame() === 'choice'"
        [class.hint]="frame() === 'hint'"
        [class.pointed]="pointer()"
        #pop
        class="pop"
      >
        @if (pointer()) {
          <span
            [class.down]="appliedSide() === 'below'"
            [class.up]="appliedSide() === 'above'"
            [style.left.px]="pointerLeft()"
            #pointerMark
            aria-hidden="true"
            class="ptr"
          ></span>
        }
        @if (pointer() && frame() === 'choice') {
          <div class="clip">
            <ng-container [ngTemplateOutlet]="content" />
          </div>
        } @else {
          <ng-container [ngTemplateOutlet]="content" />
        }
      </div>
    </ng-template>
    <ng-template #content><ng-content /></ng-template>
  `,
  styleUrl: './anchored-popover.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnchoredPopover {
  /** Whether it is on screen. */
  readonly open = input(false);

  /**
   * What it is held against: a directive on the page, or an element the container
   * was handed, such as the button that was just pressed (velista `0116`).
   */
  readonly origin = input.required<
    CdkOverlayOrigin | FlexibleConnectedPositionStrategyOrigin
  >();

  /** Which edge of {@link origin} it lines up with. */
  readonly align = input<AnchoredPopoverAlign>('start');

  /**
   * Which side it tries first. Above by default, because most anchors sit at the
   * foot of the screen. An anchor near the top with tools above it asks for below
   * (velista `0134`), or the popover would cover them while it still fits.
   */
  readonly side = input<AnchoredPopoverSide>('above');

  /** Its frame: a padded note, or rows to its edges. */
  readonly frame = input<AnchoredPopoverFrame>('note');

  /** The id of the element inside it that names it, for the dialog's label. */
  readonly labelledBy = input<string | null>(null);

  /**
   * Its role: a dialog by default. A hint that never takes focus and is said through
   * its anchor's own live region passes null, and is no dialog (velista `0188`).
   */
  readonly role = input<'dialog' | null>('dialog');

  /**
   * Whether it is pushed back onto the screen when no place fits whole, so an anchor
   * near an edge of a 320 px screen still shows all of it (velista `0188`).
   */
  readonly push = input(false);

  /**
   * Whether it points at its anchor (velista `0206`): for a popover about one
   * control, so it cannot be taken for another row's. It then opens wholly above or
   * wholly below, never pushed over the anchor, and {@link push} is ignored. Off,
   * it draws, sits and behaves as it always has.
   */
  readonly pointer = input(false);

  /**
   * An element that holds the anchor, such as its row, which a popover with a
   * pointer must not cover either (velista `0206`). The gap is measured from its
   * edge, and `align` `end` lines up with its end. Read only with {@link pointer}.
   */
  readonly keepInSight = input<Element | null>(null);

  /**
   * Draws its border, and its pointer's, in the colour the caller sets on
   * `--anchored-popover-accent` (velista `0206`). No fill changes.
   */
  readonly accent = input(false);

  /** It wants to close, and why. */
  readonly closed = output<AnchoredPopoverClose>();

  protected readonly viewportMargin = VIEWPORT_MARGIN;

  private readonly document = inject(DOCUMENT);

  private readonly popRef = viewChild<ElementRef<HTMLElement>>('pop');

  private readonly pointerRef =
    viewChild<ElementRef<HTMLElement>>('pointerMark');

  /** Bumped when the page scrolls or resizes, so the places are measured again. */
  private readonly layout = signal(0);

  /**
   * The side the overlay put it on, which the pointer follows. The side that was
   * asked for is its first guess each time it opens, until the overlay says.
   */
  protected readonly appliedSide = linkedSignal<AnchoredPopoverSide>(() => {
    this.open();
    return this.side();
  });

  /** The pointer's start edge inside the popover's border, in pixels. */
  protected readonly pointerLeft = signal(0);

  private readonly plainPositions = computed(() => {
    const align = this.align();
    const positions =
      align === 'end' ? END : align === 'center' ? CENTER : START;
    return this.side() === 'below' ? [...positions].reverse() : positions;
  });

  private readonly pointedPositions = computed(
    () => {
      // Measured when it opens and after a scroll or a resize: the anchor's place
      // inside its row is what the offsets are made of.
      this.open();
      this.layout();
      const row = this.keepInSight();
      return pointedPositions(
        this.align(),
        this.side(),
        boxOf(this.origin()),
        row ? boxOf(row) : null
      );
    },
    { equal: samePositions }
  );

  protected readonly positions = computed(() =>
    this.pointer() ? this.pointedPositions() : this.plainPositions()
  );

  constructor() {
    // While a popover with a pointer is open, a scroll or a resize places the
    // pointer again over the anchor's middle.
    effect((onCleanup) => {
      const view = this.document.defaultView;
      if (!this.open() || !this.pointer() || !view) {
        return;
      }
      let frame = 0;
      const again = (): void => {
        if (frame) {
          return;
        }
        frame = view.requestAnimationFrame(() => {
          frame = 0;
          this.layout.update((count) => count + 1);
          this.placePointer();
        });
      };
      view.addEventListener('scroll', again, { capture: true, passive: true });
      view.addEventListener('resize', again, { passive: true });
      onCleanup(() => {
        view.removeEventListener('scroll', again, { capture: true });
        view.removeEventListener('resize', again);
        if (frame) {
          view.cancelAnimationFrame(frame);
        }
      });
    });
  }

  /** The overlay placed it: the pointer turns to face the anchor and moves over it. */
  protected onPosition(change: ConnectedOverlayPositionChange): void {
    this.appliedSide.set(
      change.connectionPair.overlayY === 'bottom' ? 'above' : 'below'
    );
    this.placePointer();
  }

  /**
   * Puts the pointer's centre on the anchor's horizontal centre, held to the
   * straight part of the edge: the edge less the corner's radius and half the
   * pointer at each end.
   */
  private placePointer(): void {
    const pop = this.popRef()?.nativeElement;
    if (!this.pointer() || !pop) {
      return;
    }
    const anchor = boxOf(this.origin());
    const box = pop.getBoundingClientRect();
    const half = (this.pointerRef()?.nativeElement.offsetWidth ?? 0) / 2;
    const radius =
      parseFloat(
        this.document.defaultView?.getComputedStyle(pop)
          .borderBottomLeftRadius ?? ''
      ) || 0;
    const low = radius + half;
    const high = box.width - radius - half;
    const wanted = anchor.left + anchor.width / 2 - box.left;
    const centre =
      high < low ? box.width / 2 : Math.min(Math.max(wanted, low), high);
    this.pointerLeft.set(centre - pop.clientLeft - half);
  }

  /** Escape closes it, and the keypress goes no further. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit('escape');
    }
  }
}
