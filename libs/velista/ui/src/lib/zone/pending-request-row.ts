import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { PendingRequestRowVm } from '@portfolio/velista/models';

/**
 * Somebody waiting to be let in, with the two answers.
 *
 * ## No confirm, on purpose
 *
 * Approve and reject are one tap each. They are the commonest action on this screen,
 * and they are reversible in the sense that matters: somebody turned down can ask
 * again with the code. Putting a sheet in front of them would make an owner tap twice
 * for every person who ever joins their household (plan 0010, section 4.2).
 *
 * ## The one pair worth separating
 *
 * These are the two most consequential adjacent controls in the app, and the only pair
 * where a misfire cannot be corrected by the person who made it: turning somebody down
 * by accident is not undoable from here, and letting somebody in by accident means
 * removing them. So they are full sized targets with a real gap, and reject is the
 * quieter of the two (section 7).
 */
@Component({
  selector: 'lib-pending-request-row',
  imports: [RokuTranslatorPipe],
  template: `
    <div [attr.aria-busy]="request().busy" class="row">
      <span aria-hidden="true" class="avatar">{{ request().initial }}</span>
      <span class="name">{{ request().name }}</span>

      <span class="answers">
        <button
          (click)="reject.emit(request().membershipId)"
          [disabled]="request().busy"
          class="answer reject"
          type="button"
        >
          {{ 'zone.members.reject' | rokuT }}
        </button>

        <button
          (click)="approve.emit(request().membershipId)"
          [disabled]="request().busy"
          class="answer approve"
          type="button"
        >
          {{ 'zone.members.approve' | rokuT }}
        </button>
      </span>
    </div>
  `,
  styleUrl: './pending-request-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingRequestRow {
  readonly request = input.required<PendingRequestRowVm>();

  readonly approve = output<string>();
  readonly reject = output<string>();
}
