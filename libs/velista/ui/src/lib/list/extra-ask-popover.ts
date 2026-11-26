import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AnchoredPopover } from './anchored-popover';
import { ExtraAsk } from './extra-ask';
import { ExtraAskHost } from './extra-ask-host';
import { ExtraAskNotice } from './extra-ask-notice';

/**
 * The question about the extra already bought, and the notice a count that wrote
 * nothing leaves, as one page or sheet draws them (velista `0208`, target state
 * 10): `lib-anchored-popover` in the `choice` frame with its pointer on the
 * control, aligned to the end of what it keeps in sight, on the side the host
 * asked for, its border in the accent while the question flashes. It reads the
 * `ExtraAskHost` its page or sheet provides, and each host puts one in its
 * template.
 *
 * Only "Count the extra" writes: whatever else closes it leaves the amount set,
 * which the raise already wrote. The notice has no buttons and takes no focus,
 * and goes on the next touch anywhere, on Escape and on leaving.
 */
@Component({
  selector: 'lib-extra-ask-popover',
  imports: [AnchoredPopover, ExtraAsk, ExtraAskNotice],
  template: `
    @if (host.asked(); as asked) {
      @if (asked.shown) {
        @if (host.words(); as words) {
          <lib-anchored-popover
            (closed)="host.close($event)"
            [accent]="host.flashing()"
            [keepInSight]="asked.keepInSight"
            [labelledBy]="host.titleId"
            [open]="true"
            [origin]="asked.origin"
            [pointer]="true"
            [side]="asked.side"
            align="end"
            frame="choice"
          >
            <lib-extra-ask
              (dismissed)="host.close('escape')"
              (kept)="host.answerCount()"
              (stillNeed)="host.answerStillNeed()"
              [takeFocus]="asked.takeFocus"
              [titleId]="host.titleId"
              [words]="words"
            />
          </lib-anchored-popover>
        }
      }
    }

    @if (host.notice(); as notice) {
      @if (host.noticeWords(); as words) {
        <lib-anchored-popover
          (closed)="host.closeNotice()"
          [keepInSight]="notice.keepInSight"
          [open]="true"
          [origin]="notice.origin"
          [pointer]="true"
          [role]="null"
          [side]="notice.side"
          align="end"
          frame="choice"
        >
          <lib-extra-ask-notice
            (pointerdown)="host.closeNotice()"
            [words]="words"
          />
        </lib-anchored-popover>
      }
    }

    @if (host.ownRegion()) {
      <p aria-live="polite" class="region" role="status">
        {{ host.announcement() }}
      </p>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    .region {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExtraAskPopover {
  protected readonly host = inject(ExtraAskHost);
}
