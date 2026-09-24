import {
  CdkConnectedOverlay,
  type CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/** Why an {@link AnchoredPopover} asked to close. */
export type AnchoredPopoverClose = 'escape' | 'outside' | 'detach';

/**
 * Above the anchor and aligned with its start edge, since the anchors this is drawn
 * against sit at the foot of the screen and the room is upward; below it when the
 * anchor is near the top.
 */
const POSITIONS: ConnectedPosition[] = [
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
      [cdkConnectedOverlayPositions]="positions"
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

  /** What it is held against. */
  readonly origin = input.required<CdkOverlayOrigin>();

  /** The id of the element inside it that names it, for the dialog's label. */
  readonly labelledBy = input<string | null>(null);

  /** It wants to close, and why. */
  readonly closed = output<AnchoredPopoverClose>();

  protected readonly positions = POSITIONS;

  /** Escape closes it, and the keypress goes no further. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit('escape');
    }
  }
}
