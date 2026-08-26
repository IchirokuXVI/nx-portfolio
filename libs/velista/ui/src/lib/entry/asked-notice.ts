import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ClockIcon } from '../icons/icons';

/**
 * What somebody sees after asking to join: that they asked, and that it is now
 * somebody else's decision.
 *
 * No action, deliberately. There is nothing the person can do to speed this up, and a
 * button that only re-states the wait would suggest otherwise. The group is listed
 * below with its PENDING badge, which is the card `0003` already designed, and the
 * page updates itself when the approval arrives over realtime rather than asking
 * anybody to refresh.
 *
 * It says the group's real name, which is only possible after the reload the ask
 * triggers: nothing can turn a code into a name before you have used it (plan 0008,
 * sections 5.6 and 5.7).
 */
@Component({
  selector: 'lib-asked-notice',
  imports: [RokuTranslatorPipe, ClockIcon],
  template: `
    <section class="panel">
      <span aria-hidden="true" class="mark">
        <lib-clock-icon class="glyph" />
      </span>
      <h2 class="title">
        {{ 'entry.asked.title' | rokuT: { name: zoneName() } }}
      </h2>
      <p class="body">{{ 'entry.asked.body' | rokuT }}</p>
    </section>
  `,
  styleUrl: './asked-notice.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AskedNotice {
  readonly zoneName = input.required<string>();
}
