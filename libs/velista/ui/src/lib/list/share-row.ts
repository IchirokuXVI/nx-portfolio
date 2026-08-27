import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ListRole, ShareRowVm } from '@portfolio/velista/models';

/** The three things a member can be, where null means no access at all. */
type Choice = { readonly role: ListRole | null; readonly key: string };

/**
 * One member, and what they may do with this list.
 *
 * ## The visible label and the accessible name deliberately differ
 *
 * Three segments have to fit across a 390 wide phone and "Can add and tick off" does
 * not. So the segment **shows** the short label and is **named** by the long one: a
 * screen reader hears the whole phrase and never the abbreviation. This is the one
 * place in the app where the two diverge, and it is written down here and in the plan
 * so nobody later tidies the long keys away as duplicates (section 6).
 *
 * ## A fixed row is explained, not just disabled
 *
 * The list's creator is a writer who cannot be demoted, and zone staff can always open
 * every list in their zone and are not in the payload at all. Both render as a row with
 * a sentence saying why rather than as three greyed out buttons, because a disabled
 * control with no explanation reads as a bug.
 */
@Component({
  selector: 'lib-share-row',
  imports: [RokuTranslatorPipe],
  template: `
    <div class="row">
      <span class="name">{{ member().username }}</span>

      @if (member().fixed) {
        <span class="fixed">{{ member().fixedReasonKey! | rokuT }}</span>
      } @else {
        <div
          [attr.aria-label]="
            'list.settings.accessFor' | rokuT: { name: member().username }
          "
          class="choices"
          role="radiogroup"
        >
          @for (choice of choices; track choice.key) {
            <button
              (click)="choose(choice.role)"
              [attr.aria-checked]="member().role === choice.role"
              [attr.aria-label]="longKeyOf(choice.role) | rokuT"
              [class.selected]="member().role === choice.role"
              class="choice"
              role="radio"
              type="button"
            >
              {{ choice.key | rokuT }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './share-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareRow {
  readonly member = input.required<ShareRowVm>();

  readonly changed = output<{
    membershipId: string;
    role: ListRole | null;
  }>();

  /** The short labels, which are what fits. Order is least access to most. */
  readonly choices: readonly Choice[] = [
    { role: null, key: 'list.settings.access.shortNone' },
    { role: 'READER', key: 'list.settings.access.shortReader' },
    { role: 'WRITER', key: 'list.settings.access.shortWriter' },
  ];

  /** The full phrase each segment is named by, for anybody listening rather than looking. */
  longKeyOf(role: ListRole | null): string {
    switch (role) {
      case 'READER':
        return 'list.settings.access.reader';
      case 'WRITER':
        return 'list.settings.access.writer';
      default:
        return 'list.settings.access.none';
    }
  }

  choose(role: ListRole | null): void {
    if (this.member().fixed || this.member().role === role) {
      return;
    }

    this.changed.emit({ membershipId: this.member().membershipId, role });
  }
}
