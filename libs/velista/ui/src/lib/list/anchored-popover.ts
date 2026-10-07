import {
  CdkConnectedOverlay,
  type CdkOverlayOrigin,
  type ConnectedPosition,
  type FlexibleConnectedPositionStrategyOrigin,
} from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

/** Why an {@link AnchoredPopover} asked to close. */
export type AnchoredPopoverClose = 'escape' | 'outside' | 'detach';

/** Which edge of the anchor the popover lines up with. */
export type AnchoredPopoverAlign = 'start' | 'end';

/** Which side of the anchor the popover tries first. */
export type AnchoredPopoverSide = 'above' | 'below';

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
 * A small popover held against an element on the page, with whatever the container
 * puts in it (velista `0110`).
 *
 * The group help popover's wiring (`SuggestionList`), made into a component so a
 * second popover is not a second copy of it: a CDK connected overlay drawn as an
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
  imports: [CdkConnectedOverlay],
  template: `
    <ng-template
      (detach)="closed.emit('detach')"
      (overlayKeydown)="onKey($event)"
      (overlayOutsideClick)="closed.emit('outside')"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayOrigin]="origin()"
      [cdkConnectedOverlayPositions]="positions()"
      [cdkConnectedOverlayUsePopover]="'inline'"
      cdkConnectedOverlay
    >
      <div [attr.aria-labelledby]="labelledBy()" class="pop" role="dialog">
        <ng-content />
      </div>
    </ng-template>
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

  /** The id of the element inside it that names it, for the dialog's label. */
  readonly labelledBy = input<string | null>(null);

  /** It wants to close, and why. */
  readonly closed = output<AnchoredPopoverClose>();

  protected readonly positions = computed(() => {
    const positions = this.align() === 'end' ? END : START;
    return this.side() === 'below' ? [...positions].reverse() : positions;
  });

  /** Escape closes it, and the keypress goes no further. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit('escape');
    }
  }
}
